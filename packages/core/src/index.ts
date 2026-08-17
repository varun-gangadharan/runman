/**
 * @runman/core — the shared training-science core.
 *
 * Imported by both the Runman web app and the RunCoach MCP server so that a
 * question asked in a browser and the same question asked through an LLM tool
 * call resolve to identical numbers from identical code. Every exported
 * calculation reports the method and confidence behind its result; nothing in
 * here returns a bare number whose provenance the caller cannot inspect.
 */

export * from './types.ts';
export * from './time.ts';
export * from './dataQuality.ts';
export * from './heartRate.ts';
export * from './performance.ts';
export * from './trainingLoad.ts';
export * from './volume.ts';
export * from './racePrediction.ts';
export * from './trainingPlan.ts';
export * from './status.ts';
export * from './strava.ts';
export * from './stravaExport.ts';
