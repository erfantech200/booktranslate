# Bookbridge brand

**Mark.** An open book whose underside is a pointed Persian arch, as on Isfahan's Si-o-se-pol
bridge. Below it, the arch's reflection is drawn in turquoise water. A saffron keystone sits where
the pages meet. Files: `mark.svg` (on light), `mark-reversed.svg` (on lapis), `app-icon.svg`
(rounded lapis tile). The React version is `apps/web/src/components/Logo.tsx`.

**Colour** (tokens in `apps/web/src/app/globals.css`), from manuscript and tile pigments:

| Token | Hex | Use |
|---|---|---|
| lajvard (lapis) | `#1E2F6B` | primary, navigation spine, headings |
| firoozeh (turquoise) | `#1F8F89` | done / translated, progress |
| zafaran (saffron) | `#D4921A` | in progress, warnings, focus ring, spine bands |
| anar (pomegranate) | `#B4363F` | errors, needs review |
| paper | `#F1F3F6` | page background |
| ink | `#1A1F33` | body text |

**Type.**
- Noto Kufi Arabic (Persian) with Reem Kufi (Latin) for titles and the wordmark. Reem Kufi's own
  Arabic glyphs dot the final Persian «ی», so it is used for Latin only.
- Estedad for the interface.
- Noto Naskh Arabic for translated text, matching the printed PDF.

All fonts are OFL and self-hosted in `apps/web/src/fonts`.

**Motion.** There is one animation: the reflection draws in on the sign-in screen. It is
disabled under `prefers-reduced-motion`.
