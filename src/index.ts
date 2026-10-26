/**
 * story-state-engine — context & state management for long-form AI fiction.
 *
 * The event log is the single source of truth; entities, foreshadowing and
 * chapters are projections. Feed the engine's `extractContext()` output to
 * any LLM and its context window becomes a precise, verifiable window into
 * your novel — no matter how long the book grows.
 */

export * from './types.js';
export * from './errors.js';
export * from './ids.js';
export * from './timeline.js';
export * from './state.js';
export * from './entities.js';
export { StoryEngine, type StoryEngineOptions, type SaveSlotOptions } from './StoryEngine.js';
export * from './persistence/index.js';
export * from './extractor/index.js';
