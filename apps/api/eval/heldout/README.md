# Held-out evaluation cases

These invented cases are separate from `../fixtures.json`, are never used by the build threshold, and are not used to tune the deterministic checks. Run them only with `npm run eval --workspace @cleared/api -- --heldout`. The held-out mode is deterministic only and prints aggregate counts and metrics, not fixture text. Add local cases as additional `*.json` files containing an array of cases with `id`, `draft`, `source`, `expected`, and optional `categories` fields. Do not put real customer text or secrets here.
