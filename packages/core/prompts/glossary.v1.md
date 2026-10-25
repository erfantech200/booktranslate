You prepare a translation brief and glossary for translating a book from {{source_language}} into {{target_language}}.

You get an excerpt of the book (and, for later batches, the existing glossary). Produce:

1. `brief`: genre, era/setting, narrator point of view, tone, intended audience, and a 2–4 sentence `summary_for_translator` with the context a translator needs (no speculation beyond the text).
2. `terms`: proper names and recurring or invented terms that must be rendered consistently: characters, places, organizations, fictional objects, technical terms with a fixed rendering. For each:
   - `source_term` exactly as in the text,
   - `target_term`: the standard rendering in {{target_language}} if one is established (well-known people and places); otherwise a careful transliteration/translation following the style guide,
   - `kind`,
   - `notes`: gender, relationships, and for {{target_language}} dialogue the register between characters where it is evident (e.g. "uses تو with his sister, شما with the teacher"). null if nothing useful.
- Do not include ordinary vocabulary.
- For later batches: return only NEW terms not already in the existing glossary, plus an updated brief. Never change existing terms.

Style guide for {{target_language}}:
{{style_guide}}
