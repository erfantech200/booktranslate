# OpenAI API: what was verified (2026-10-25)

platform.openai.com and developers.openai.com could not be reached from the build
container (DNS blocked). The facts below therefore come from the **official `openai`
Node SDK, v7.43.0** (its type definitions are generated from OpenAI's OpenAPI spec),
with prices cross-checked against third-party reports. Re-check anything marked
*unverified* on the pricing page before relying on cost numbers.

## Model IDs (from `openai/resources/shared.d.ts`, `ChatModel` union)

| Role | Env var | Default | Status |
|---|---|---|---|
| OCR / page extraction (vision) | `OCR_MODEL` | `gpt-6-luna` | in SDK |
| Structuring pass (text-layer pages) | `STRUCTURE_MODEL` | `gpt-6-luna` | in SDK |
| Brief + glossary | `GLOSSARY_MODEL` | `gpt-6.1-sol` | in SDK |
| Translation | `TRANSLATION_MODEL` | `gpt-6.1-sol` | in SDK |
| Premium translation | `PREMIUM_TRANSLATION_MODEL` | `gpt-6-astra` | in SDK (bare ID, no dated snapshot) |

`gpt-6-sol` also exists. Third-party pages call `gpt-6.1-sol` a pricing twin of `gpt-6-sol`.

## Responses API parameters used

- `client.responses.parse({ model, instructions, input, text: { format }, reasoning: { effort }, max_output_tokens, prompt_cache_key, prompt_cache_retention, safety_identifier, store })`
- Structured Outputs: `text.format = { type: 'json_schema', name, schema, strict: true }`,
  built with `zodTextFormat(schema, name)` from `openai/helpers/zod` (SDK peer dep: `zod ^3.25 || ^4`).
  The parsed value is `response.output_parsed`.
- `reasoning.effort`: `'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`.
  Not every model accepts every value. Configured per stage via env.
- Images: input item `{ type: 'input_image', image_url: <data URL or https URL>, detail: 'low' | 'high' | 'auto' | 'original' }`.
- Prompt caching: automatic for long, identical prefixes. `prompt_cache_key` (string) improves
  routing hits; `prompt_cache_retention: 'in_memory' | '24h'`. `user` is deprecated in favour of
  `safety_identifier` + `prompt_cache_key`.
- Usage: `usage.input_tokens`, `usage.input_tokens_details.cached_tokens`,
  `usage.input_tokens_details.cache_write_tokens`, `usage.output_tokens`,
  `usage.output_tokens_details.reasoning_tokens`.
- Batch API: `client.batches.create({ endpoint: '/v1/responses', input_file_id, completion_window: '24h' })`
  (Phase 2, "Cheap" mode).

## Prices (`packages/core/config/prices.json`)

USD per 1M tokens. **Unverified.** The sources are TheNextWeb, llmgateway and requesty
(September/October 2026):

| Model | input | cached input | cache write | output |
|---|---|---|---|---|
| gpt-6-luna | 0.10 | 0.01 | 0.125 | 0.50 |
| gpt-6-sol / gpt-6.1-sol | 2.00 | 0.20 *(assumed 10%)* | 2.50 *(assumed)* | 10.00 |
| gpt-6-astra | 10.00 | 1.00 | 12.50 *(assumed)* | 50.00 |

Batch API: 50% of the above. Long-context surcharges (>272K input) never apply here,
because chunks are a few thousand tokens.
