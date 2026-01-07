// Battle Dinghy - Core Package

// Core types
export * from './types.js';

// Card generation
export * from './card-generator.js';

// Game engine (excluding OreRoundResult to avoid conflict with ore-monitor)
export type {
  GameConfig,
  RoundSummary,
  ShotResult,
  SerializedGameState,
} from './game-engine.js';

export { GameEngine, generateMockOreResults } from './game-engine.js';

// ORE monitor (OreRoundResult is canonical here)
export * from './ore-monitor.js';

// Commit-reveal scheme (Security mitigation C1)
export * from './commit-reveal.js';

// ORE block commitment (Security mitigation C2)
export * from './ore-block-commitment.js';
