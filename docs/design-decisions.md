# Design Decisions

Working notes on the reasoning behind Sentry's less-obvious design choices — where the
tradeoffs are, what was rejected and why, and where the current design intentionally
stops short. Four areas: fraud detection, recurring charge detection, the notification
architecture, and manual category overrides.

## Fraud Detection

Why unsupervised anomaly detection, why Isolation Forest specifically, what each
engineered feature is trying to capture, and where the design intentionally stops
short.

### Why unsupervised, not a trained classifier

Fraud detection is usually framed as classification, but that framing assumes
something Sentry doesn't have: a labeled dataset of "this transaction was
fraud" for *this specific user*. A handful of options exist and all fail for a
personal-finance product at this scale:

- **Public fraud datasets** (e.g. Kaggle's credit-card-fraud set) are
  anonymized, PCA-transformed, and describe someone else's spending. A model
  trained on them learns nothing about whether $85 at Trader Joe's is normal
  for *you*.
- **Cross-user supervised learning** would need thousands of users with
  confirmed fraud/not-fraud labels before a model generalizes — not something
  a new personal-finance app has on day one, and even then it optimizes for
  "fraud in general" rather than "unusual for this account."
- **Rule engines** (velocity checks, new-merchant-plus-high-amount) are what
  real card networks actually run in production, and they're a reasonable
  complement, but they don't adapt to an individual's baseline and need manual
  tuning per rule.

What Sentry actually has, per user, is a clean history of *normal* spending.
That's exactly the setup unsupervised anomaly detection wants: model what
"normal" looks like for this one account, then flag whatever doesn't fit. No
labels required, and it's inherently personalized — a $400 restaurant charge
is unremarkable for one household's baseline and wildly anomalous for
another's.

### Why Isolation Forest specifically

Within anomaly detection there are several reasonable choices (Local Outlier
Factor, One-Class SVM, autoencoders). Isolation Forest was picked for a
combination of practical reasons:

- **It's built on the right intuition for this data.** Isolation Forest's
  core idea is that anomalies are *easier to isolate* than normal points —
  a random split on a random feature separates an outlier from the rest of
  the data in very few splits, while a normal point sitting in a dense
  cluster takes many splits to isolate. The anomaly score is essentially the
  average path length to isolate a point across an ensemble of random trees;
  short paths score as anomalous. That matches the actual shape of the
  problem: most transactions cluster tightly around a few recurring
  merchants and amounts, and fraud is a small number of points that don't
  belong to any cluster.
- **No distance metric to get wrong.** LOF and most density-based methods
  need a sensible distance function over the feature space, which gets
  awkward once you mix a log-scaled amount, a categorical rarity score, and a
  cyclical hour-of-day. Isolation Forest's splits are axis-aligned and
  distance-free, so mixed, differently-scaled features don't need careful
  normalization to behave.
- **It doesn't need much data to be useful.** With a handful of months of
  transaction history per user (the realistic amount of data a new personal-
  finance account actually has), tree-based partitioning still produces a
  usable signal. A one-class SVM or autoencoder would need meaningfully more
  data per user before the model is trustworthy.
- **It's cheap.** Training and scoring is fast enough to run per-user
  synchronously inside a request (see `app/services/fraud_service.py`) rather
  than needing an offline batch pipeline.

### Feature engineering — what each feature is trying to catch

All features are computed relative to *that user's own history*
(`app/ml/features.py`), which is what makes the personalization actually
work — the model isn't learning "large transactions are suspicious," it's
learning "large *for this person, in this category* is suspicious."

| Feature | Signal it captures |
|---|---|
| `log_amount` | Raw transaction size, log-scaled so a $3,000 outlier doesn't just dominate the split on scale alone. |
| `category_zscore` | How many standard deviations this amount is from the user's own mean spend *in that category*. A $200 grocery run and a $200 restaurant tab are very different anomalies. |
| `new_merchant` | Whether this is the first time this user has ever transacted with this merchant. Fraud very often shows up as a merchant that's never appeared before. |
| `days_since_last_at_merchant` | Recency of the relationship with a merchant — a brand-new merchant and one you haven't used in a year both read as "unfamiliar" but for a legitimate reason (gap), rather than only a binary flag. |
| `hour_of_day`, `day_of_week` | Time-of-day/week patterns — a 3 a.m. purchase is a classic fraud tell that a pure amount-based model would miss entirely. |
| `velocity_24h` | Count of transactions in the trailing 24 hours — catches card-testing bursts (many small or varied charges in a short window) that no single transaction would flag on its own. |
| `category_rarity` | Frequency-encodes how rare a spending category is for this user overall — a category the user almost never uses is inherently more suspicious than a well-worn one, independent of the amount. |

A practical caveat visible in the seeded demo data: the very first occurrence
of any *recurring* merchant (rent, a subscription) also trips `new_merchant`,
since there's no history yet at that point in time. That's an honest artifact
of "unfamiliar" being a real signal early in an account's life, not a bug —
it fades out as soon as the account has a few months of history, which is
also why a purely rule-based "new merchant = flag" system would be too noisy
without the surrounding context these other features provide.

### Per-user model, with a fallback

Each user gets their own `IsolationForest`, retrained from that user's full
feature matrix and persisted with `joblib`
(`app/services/fraud_service.py::_get_model_for_user`). Below a minimum
transaction count (`FRAUD_MIN_TRANSACTIONS_FOR_PERSONAL_MODEL`, default 50) a
per-user model doesn't have enough data to be meaningful, so scoring falls
back to a global model trained across all users' feature matrices instead —
a reasonable cold-start compromise: it still catches the obvious anomalies
(huge amounts, 3 a.m. purchases, brand-new merchants) generically, without
pretending to understand a two-week-old account's "normal."

The anomaly cutoff itself is percentile-based
(`FRAUD_ANOMALY_THRESHOLD_PERCENTILE`, default the bottom 3% of decision
scores) rather than a fixed score threshold, since raw Isolation Forest scores
aren't comparable in any absolute sense across users with different data
distributions — percentile-within-user is the thing that's actually
meaningful.

### What feedback-driven retraining would look like (not built)

Confirm/dismiss actions on a flag are recorded (`FraudFlag.status`) but
currently only affect what's displayed — they don't feed back into the model.
If this went further, a few directions are worth naming:

- **Simplest — treat dismissals as synthetic "normal" labels.** Fold
  dismissed transactions back into the training set for that user's *next*
  retrain, explicitly as inliers. This nudges the per-user model's notion of
  "normal" without needing a second model at all, and is the natural next
  step given the current architecture.
- **A second-stage supervised layer, once labels accumulate.** After a user
  has enough confirmed/dismissed flags, the same engineered feature vector
  could train a small supervised classifier (logistic regression or gradient
  boosting) *on top of* the Isolation Forest's anomaly score, effectively
  learning "of the things the unsupervised model flags as unusual, which
  ones does *this user* actually consider fraud." That's a meaningfully
  different, harder project than the fold-back approach — it needs enough
  labeled examples per user to avoid overfitting on maybe a dozen data
  points, which is the real blocker to building it now.
- **Merchant- or category-level threshold adjustment.** If a user repeatedly
  dismisses flags at the same recurring merchant (a legitimately large but
  irregular annual payment, say), that merchant could get a locally
  loosened threshold rather than waiting for a full retrain cycle to absorb
  it.

None of this is implemented — it's a scope cut, not an oversight — but the
`status` field and the per-user model boundary already in place are exactly
what any of these three directions would build on.

## Recurring Charge Detection

Sentry detects subscriptions and recurring bills (`app/services/recurring_service.py`)
purely by analyzing transaction history — there's no ML model here, and deliberately so.

### Why frequency analysis over history, not the Plaid liabilities product

Plaid exposes a `liabilities` product with real due dates and minimum payments for
credit/loan accounts. It was considered and rejected for this project specifically:
the demo runs on `scripts/seed_sandbox.py` synthetic data, not a live Sandbox link, and
`liabilities` data wouldn't exist for a seeded account — the feature would be invisible
in the exact context it needs to demo well in. Deriving recurring charges from
transaction history instead works identically whether the account is seeded or really
linked, and generalizes to *any* recurring charge (rent, subscriptions, a weekly gas
fill-up), not just credit/loan liabilities.

### The algorithm

1. **Group by normalized merchant.** Lowercase, strip punctuation, strip trailing
   digit runs of 2+ (store numbers), collapse whitespace. Groups under 3 occurrences
   are dropped immediately — that alone rejects one-off purchases and every
   distinctly-named injected fraud transaction in the seed data.
2. **Classify cadence from the median gap** between occurrences (weekly, biweekly,
   monthly, quarterly, annual buckets). The *median*, not the mean, so one skipped
   cycle doesn't distort the read.
3. **Gate on regularity**, not just cadence. Median-absolute-deviation of the gaps
   must fall within a per-cadence tolerance, and — for monthly specifically — the
   day-of-month must also be stable (real month lengths make raw day-gaps noisy in a
   way day-of-month isn't).
4. **Score confidence** as a weighted blend of interval regularity, amount stability,
   and occurrence count, and use the *most recent* 1–3 charges (not a full-history
   average) to set the expected amount — so a subscription price increase is reflected
   rather than averaged away.
5. **Never delete, just deactivate.** A merchant that stops recurring (cancelled
   subscription) or falls too far past its predicted next date is marked `inactive`,
   not removed — the same "don't destroy history" instinct as the fraud flag's
   `status` field.

### A real false positive, and what it revealed

Running this against the seeded demo data caught a genuine gap in the design, worth
stating plainly rather than glossing over: **a restaurant chosen at random each week
from a list of five got flagged as a biweekly recurring charge.** Its actual gaps were
`[42, 14, 14, 49, 14]` days — three coincidental two-week repeats and two large gaps.
Median-absolute-deviation is robust to *one* outlier surrounded by a regular cluster,
but it has a blind spot: with few samples, it can't tell "mostly regular with one skip"
apart from "a regular-looking cluster plus a couple of wild outliers," because the
median and MAD both simply land on the cluster and ignore the outliers' *spread*.

The fix adds a second, independent gate: the full range of the gaps (`max − min`)
can't exceed several multiples of that cadence's tolerance. A single skipped month
still passes (the range stays proportional to one cycle length); a coincidental
same-week repeat sitting next to two-month gaps doesn't. Verified against the seeded
data post-fix: the five real recurring charges (rent, three subscriptions, weekly gas)
are still detected, and the random-choice merchants are not.

This is left in the codebase as an honest example of iterating against real output
rather than only against hand-picked test cases — the unit tests in
`tests/test_recurring.py` encode both the original MAD gate and this range gate as
separate, explicit checks.

## Notification Architecture

### Why no background scheduler

A locally-run app is off most of the time, which makes an in-process scheduler
(APScheduler, etc.) mostly theater: it only fires while the process happens to be
running, adds a background-thread lifecycle to reason about, and is awkward to test.
Instead, notification evaluation (`notification_service.evaluate_and_send`) is a plain
function called two ways: automatically at the end of every `/plaid/sync`, and on
demand via `POST /notifications/run` (exposed as "Run check now" in the UI). Anyone
who wants true unattended scheduling can point an OS-level cron/Task Scheduler entry
at that endpoint — zero extra application code, and the endpoint is exactly as testable
either way.

### Why skipped sends still get logged

`NotificationLog` has a unique constraint on `(user_id, dedup_key)`, and a row is
written whether the send actually succeeded, was skipped (no `RESEND_API_KEY`
configured), or failed. The alternative — only logging real sends — would mean adding
a Resend key later replays every notification that *would* have fired while the key
was unset, potentially flooding an inbox with months of backlogged budget/bill alerts
the moment the key is added. Logging "skipped" as handled trades that off deliberately:
it's a one-line change (`if result != "skipped": db.add(...)`) to flip if the opposite
behavior is ever preferred.

## Manual Category Override

### Why a separate column, not overwriting `category_primary`

`app/routers/plaid.py::_run_sync_for_item` overwrites a transaction's `category_primary`
and `category_detailed` unconditionally on every re-sync, straight from whatever Plaid
returns that time — there was no guard against it before this feature, and adding one
felt like the wrong fix. A user's correction stored in `category_primary` would get
silently clobbered the next time that transaction happened to come back in a sync
batch (Plaid resends `modified` transactions, not just genuinely new ones).

Instead, `Transaction.category_override` (`app/models/transaction.py`) is a separate,
nullable column that sync never touches, paired with an `effective_category` computed
via `sqlalchemy.ext.hybrid.hybrid_property` — one Python expression
(`category_override or category_primary`) that also compiles to real SQL
(`COALESCE(category_override, category_primary)`) so it works identically as a
Python attribute and inside `.filter()`/`.group_by()` in the same query. The override
survives every future sync for free, and clearing it (`category_override = null`)
cleanly reverts to whatever Plaid currently says — no separate "restore original"
logic needed, since the original was never touched.

The cost of this approach is that `effective_category` had to be threaded through
every place that previously grouped or filtered on `category_primary` directly:
`budget_service` (both the exclusion filter and the per-category aggregation),
`fraud_service`'s feature-matrix query, and the transactions list/search endpoint.
Missing any one of them would mean an override silently doesn't affect the thing a
user would reasonably expect it to — e.g. recategorizing a charge as `TRANSFER_OUT`
but it still counting toward spend totals.

### The fraud-model coupling this creates

`fraud_service._fetch_expense_df` now selects `effective_category`, which means a
category correction changes that user's fraud feature vectors (`category_zscore`,
`category_rarity`) the next time transactions are scored. This is intended — the
model should learn from the corrected data, the same way it should learn from
anything else about a user's real spending — but it's a real coupling between two
features that otherwise look unrelated, worth stating explicitly rather than leaving
implicit.
