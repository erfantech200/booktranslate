// Client-safe exports for the web app: no Node built-ins, no DB, no OpenAI.
export {
  BookSettings, parseBookSettings, ExportOptions, ExportScope, BLOCK_TYPES, GLOSSARY_KINDS,
  isRtl, languageName, LANGUAGE_NAMES, type LintFlag, type Warning, type JobType, type BlockType,
} from './types';
export { costUsd, estimateRun, estimateTokens, priceFor, type RunEstimate } from './cost';
export { stageModel, prices, pageSizes, type PageSizeKey } from './config';
export { toPersianDigits } from './lint/fa';
