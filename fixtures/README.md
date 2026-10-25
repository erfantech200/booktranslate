# Fixtures

- `generated/` — synthetic page "photos" (normal, two-page spread, skewed, blurry), a scanned PDF
  and a text PDF of *The Lantern Keeper*, a short invented text written for these tests
  (`packages/core/test/fixtures/lanternKeeper.ts`). Regenerate with `pnpm fixtures`.
  The golden pipeline test (`pnpm db:test`) runs them through every stage with a deterministic
  fake model, so it checks ordering, spread splitting, stitching, quality warnings, caching,
  glossary handling, Persian lint and the PDF/EPUB exports — not translation quality.
- `real/` (git-ignored) — put real phone photos here (including one spread, one skewed and one
  blurry page, plus a scanned and a text PDF). They are what the Phase 1 acceptance run uses with
  a real `OPENAI_API_KEY`: upload them through the app and check the PDF/EPUB by eye.
- `out/` (git-ignored) — renders written by tests and scripts.
