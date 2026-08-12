# Design Decisions

Working notes on the reasoning behind Sentry's less-obvious design choices — where the
tradeoffs are, what was rejected and why, and where the current design intentionally
stops short. Five areas: fraud detection, recurring charge detection, the notification
architecture, manual category overrides, and automatic sync.

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

### Feedback-driven retraining

Confirm/dismiss actions on a flag are recorded (`FraudFlag.status`) and now
feed back into the next scoring pass, via two mechanisms
(`app/services/fraud_service.py`). No new trigger was needed for either:
`_get_model_for_user` already retrains from scratch on every scoring call
once a user clears the personal-model transaction threshold, so feedback
takes effect on the user's next sync — there's no retrain button in the UI,
deliberately (see below).

**1. Training-set curation.** `_curate_training_frame` drops `confirmed`
rows from training entirely — confirmed fraud isn't an example of "normal,"
and before this change it silently contaminated the very distribution the
model called normal. `dismissed` rows are kept and repeated in the training
frame (default 4×, `FRAUD_DISMISSED_REPEAT_COUNT`).

That "repeated" is deliberate phrasing, not "upweighted," and it's the one
real surprise in this feature: `IsolationForest.fit` accepts a
`sample_weight` argument, and the initial plan was to pass dismissed rows in
at a higher weight rather than physically duplicate them. Testing it — by
comparing `decision_function` output across `sample_weight` values from
`0.001` to `1000`, both with and without `bootstrap=True` — turned up that it
has **no measurable effect on this estimator's output at all**. The reason
is structural: `IsolationForest`'s trees pick a uniformly random *threshold*
within each node's actual data range (`splitter="random"`), not a
criterion-optimized one, so nothing about how the split point is chosen
consults sample weight. Physically repeating a row, by contrast, changes the
data reaching each node and measurably shifts `decision_function` — verified
against the same test harness. `FRAUD_DISMISSED_REPEAT_COUNT` names what
actually happens rather than a parameter that turned out to be a no-op.

**2. Merchant-level suppression.** If a user has dismissed
`FRAUD_MERCHANT_SUPPRESSION_MIN_DISMISSALS` (default 2) flags at the same
merchant — grouped with the same `normalize_merchant` used for recurring
detection, so `"Netflix"` and `"NETFLIX #123"` collapse together — a new
transaction at that merchant needs to clear a stricter percentile cutoff to
flag again (`FRAUD_MERCHANT_SUPPRESSION_PERCENTILE_RATIO`, default 0.33× the
normal threshold) rather than the standard one.

This is deliberately a **raised bar, not a whitelist**: the stricter cutoff
still exists, so a wildly extreme charge at a previously-dismissed merchant
still flags (`test_suppression_is_raised_bar_not_whitelist`). The central
tradeoff is real, though, and worth stating plainly rather than selling this
as free: a user who dismisses genuine fraud at a merchant twice — rather
than a false positive — raises that merchant's bar for detecting the next
one too. Curation and suppression are deliberately paired for this reason:
curation alone is statistically real but gradual (repeating one row among
~150+ shifts scores but rarely flips a verdict outright), while suppression
is what makes the loop demonstrable and crisp. Both are exercised end-to-end
in `tests/test_fraud.py`, including a same-history control-vs-dismissed-user
comparison that proves the loop actually changes outcomes, not just display
state.

**What's still not built: a second-stage supervised layer.** After a user
has enough confirmed/dismissed flags, the same engineered feature vector
could train a small supervised classifier (logistic regression or gradient
boosting) *on top of* the Isolation Forest's anomaly score — learning "of
the things the unsupervised model flags as unusual, which ones does *this
user* actually consider fraud." That needs real volume to avoid overfitting:
a reasonable floor is ~25+ labeled flags with at least 5 per class. The
seeded demo produces roughly 7 flags total, so this wouldn't activate on
demo data even if built — a concrete number, not a hand-wave, for why this
stays a documented cut rather than a half-built feature.

The UI surfaces the *state* of this loop (`GET /fraud/feedback`, shown as a
"learned from N dismissals · M confirmed" line on the Alerts page, plus
which merchants are currently suppressed) but has no retrain control —
retraining isn't something a user triggers, it's what already happens on
the next scoring pass.

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

### Why notifications alone didn't need a scheduler — and why sync eventually did

This section originally argued against a background scheduler at all: a locally-run
app is off most of the time, which makes an in-process scheduler mostly theater, adds
a background-thread lifecycle to reason about, and is awkward to test. Notification
evaluation (`notification_service.evaluate_and_send`) stayed a plain function called
two ways: automatically at the end of every `/plaid/sync`, and on demand via
`POST /notifications/run`.

That reasoning was correct for notifications specifically, and it's still true today —
notifications still have no scheduler of their own, they ride on whatever sync just
ran. But it doesn't extend to *sync itself* once sync becomes something a user can ask
to happen automatically. A 1-hour auto-sync interval is exactly the case the original
argument doesn't cover: without something owning the clock, "automatic" would only
ever mean "while a browser tab happens to be open," which quietly defeats the point of
offering an interval shorter than a user's typical session. See "Automatic Sync" below
for what changed and why. The "point an OS-level cron entry at an endpoint" escape
hatch is still there too, now via `POST /sync/auto`, for anyone who'd rather not run a
background thread at all.

### Why skipped sends still get logged

`NotificationLog` has a unique constraint on `(user_id, dedup_key)`, and a row is
written whether the send actually succeeded, was skipped (no `RESEND_API_KEY`
configured), or failed. The alternative — only logging real sends — would mean adding
a Resend key later replays every notification that *would* have fired while the key
was unset, potentially flooding an inbox with months of backlogged budget/bill alerts
the moment the key is added. Logging "skipped" as handled trades that off deliberately:
it's a one-line change (`if result != "skipped": db.add(...)`) to flip if the opposite
behavior is ever preferred.

## Automatic Sync

### Extracting sync logic before it could be scheduled

`app/routers/plaid.py::_run_sync_for_item` raised `HTTPException(502)` directly on a
Plaid or token failure — reasonable for a request handler, unusable from a scheduler
tick, which has no HTTP response to raise into. Worse, the seeded demo item
deliberately carries a placeholder access token that Plaid will always reject
(see the fraud-detection seed data notes above for the same "honest artifact, not a
bug" spirit) — so a scheduler calling the sync logic as it stood would fail on that
item every single tick.

The fix was mechanical rather than clever: the entire body of `_run_sync_for_item`
moved into `app/services/sync_service.py` unchanged, with its one Plaid-failure
`raise HTTPException(...)` swapped for `raise SyncError(...)` — a plain exception with
no HTTP coupling. `plaid.py`'s version is now four lines: call `sync_service.sync_item`,
catch `SyncError`, re-raise as the same 502 as before. `/plaid/sync` and
`/plaid/exchange` are behaviorally unchanged; `autosync_service.py` can now call the
same sync logic from a background thread and handle the failure as data instead of an
HTTP exception.

### One recurring tick, not one job per user

The scheduler (APScheduler, `app/main.py`'s `lifespan` handler) runs exactly one job:
every 15 minutes, ask "who's due?" (`autosync_service.run_all_due`) and sync whoever
is. The alternative — scheduling a separate per-user job at each user's chosen
interval — was rejected because it means the scheduler's in-memory job list has to
stay in sync with whatever's in the database: change your interval, and either the
running job is stale until some reschedule logic fires, or you're now writing that
reschedule logic. A single tick that reads `SyncPreference` fresh each time has no
state to keep in sync — changing your interval in the settings page takes effect on
the very next tick, and the "if it's due" logic (`autosync_service.is_due`) is a pure
function with no relationship to how the tick itself is scheduled, so it's trivially
unit-testable without touching APScheduler at all.

### Failure isolation, at two levels

A single bad item or user must never take down a whole tick. `run_for_user` catches
`SyncError` **per item**, so if a user has two linked accounts and one has a bad token
(exactly the seeded demo user's situation), the other still syncs — verified live
against real Plaid Sandbox credentials: the demo item fails with
`INVALID_ACCESS_TOKEN`, gets recorded as `{"ok": false, "detail": "..."}`, and the run
still completes with a `partial` or `failed` status rather than raising. `run_all_due`
does the same thing one level up, catching per **user**, so one user's exception can't
stop the tick from reaching everyone else. Both levels are covered directly in
`tests/test_autosync.py` by monkeypatching `sync_service.sync_item` to fail and
asserting the batch still completes.

### Why auto-sync defaults to off

Turning it on by default would mean the seeded demo user starts failing a sync
attempt on every tick from the moment anyone clones the repo and runs the seed
script — a confusing first impression for a feature that works correctly (it degrades
gracefully, logs a `failed` status, doesn't crash anything) but has genuinely nothing
useful to *do* against a placeholder token. Anyone who imports a real Plaid key,
Sandbox or Production, gets the full experience — auto-sync and the notifications
downstream of it both work end-to-end — they just have to opt in once.

### The frontend nudge is a convenience, not the mechanism

`(app)/layout.tsx` calls `POST /sync/auto` once on mount and every 5 minutes while a
tab is open. This is deliberately *not* what makes auto-sync "automatic" — the
background scheduler already covers that, tab open or not. The nudge exists purely so
that opening the app after being away doesn't show stale data for up to
`scheduler_tick_minutes`; it's a no-op tick whenever nothing is due, and its failures
are swallowed silently (`.catch(() => {})`) since a background refresh attempt is not
something that should ever interrupt or alarm someone using the app.

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
