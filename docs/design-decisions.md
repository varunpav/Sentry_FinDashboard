# Fraud Detection: Design Decisions

This is a working note on the reasoning behind Sentry's fraud detection
approach — why unsupervised anomaly detection, why Isolation Forest
specifically, what each engineered feature is trying to capture, and where the
current design intentionally stops short.

## Why unsupervised, not a trained classifier

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

## Why Isolation Forest specifically

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

## Feature engineering — what each feature is trying to catch

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

## Per-user model, with a fallback

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

## What feedback-driven retraining would look like (not built)

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
