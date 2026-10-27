// Client-safe exports for the web app: no Node built-ins, no DB, no OpenAI.
export { COACH } from './coach.config';
export * from './engine/profile';
export * from './engine/weight';
export * from './engine/library';
export * from './engine/program';
export * from './engine/progression';
export * from './engine/schedule';
export * from './engine/session';
export * from './engine/autoreg';
export * from './engine/nutrition';
