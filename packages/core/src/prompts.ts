import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { languageName, type BookSettings } from './types';

// Prompts are versioned files in packages/core/prompts/. The version is part of every content
// hash, so editing a prompt and bumping its version re-runs exactly the affected stage.

const PROMPTS_DIR = process.env.PROMPTS_DIR
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

export const PROMPT_VERSIONS = {
  ocr: 'ocr.v1',
  structure: 'structure.v1',
  glossary: 'glossary.v1',
  translate: 'translate.system.v1',
  style: 'v1',
} as const;

const cache = new Map<string, string>();
function load(name: string): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf8').trim();
    cache.set(name, text);
  }
  return text;
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`prompt variable {{${k}}} not provided`);
    return vars[k]!;
  });
}

export function ocrPrompt(sourceLang: string) {
  return fill(load(PROMPT_VERSIONS.ocr), { source_language: languageName(sourceLang) });
}

export function structurePrompt(sourceLang: string) {
  return fill(load(PROMPT_VERSIONS.structure), { source_language: languageName(sourceLang) });
}

export function styleGuide(targetLang: string, s: BookSettings): string {
  const file = `style/${targetLang}.${PROMPT_VERSIONS.style}`;
  const name = existsSync(join(PROMPTS_DIR, `${file}.md`)) ? file : `style/default.${PROMPT_VERSIONS.style}`;
  const vars: Record<string, string> = {
    target_language: languageName(targetLang),
    dialogue_register: s.dialogueRegister,
    latin_names_rule: s.showLatinNames
      ? 'At the FIRST occurrence of each person or place name in a block marked "first occurrence", add the original Latin spelling in parentheses right after it, e.g. «الیزابت (Elizabeth)». Never elsewhere.'
      : 'Do not add the original Latin spelling.',
    digits_rule: s.persianDigits
      ? 'Write numbers in body text with Persian digits (۰–۹).'
      : 'Keep numbers in Western digits (0–9).',
    notes_rule: s.translatorNotes
      ? 'Where a cultural reference would be opaque to a Persian reader, add a short note to `translator_notes` (block_id + note). Notes are rendered as footnotes ending with «—م.»; do not write that suffix yourself. Use sparingly.'
      : 'Do not add translator\'s notes; return an empty translator_notes array.',
  };
  return fill(load(name), vars);
}

export function glossaryPrompt(sourceLang: string, targetLang: string, s: BookSettings) {
  return fill(load(PROMPT_VERSIONS.glossary), {
    source_language: languageName(sourceLang),
    target_language: languageName(targetLang),
    style_guide: styleGuide(targetLang, s),
  });
}

export function translateSystemPrompt(sourceLang: string, targetLang: string) {
  return fill(load(PROMPT_VERSIONS.translate), {
    source_language: languageName(sourceLang),
    target_language: languageName(targetLang),
  });
}
