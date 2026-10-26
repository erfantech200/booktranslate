// Client-safe exports for the web app: no Node built-ins, no DB, no OpenAI.
export { COACH } from './coach.config';
export * from './engine/profile';
export * from './engine/weight';
