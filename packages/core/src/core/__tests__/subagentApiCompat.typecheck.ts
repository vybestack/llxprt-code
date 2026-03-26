/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compile-time canary for subagent.ts type exports.
 *
 * This file must compile without errors. It is never executed as a test.
 * If a type re-export is dropped during decomposition, tsc will fail here,
 * catching the regression at compile time.
 *
 * @see packages/core/src/core/subagentApiCompat.test.ts for runtime canary.
 */

// --- Backward-compatible type exports (must always compile) ---
import type {
  SubAgentScope as SubAgentScopeType,
  OutputObject,
  PromptConfig,
  ToolConfig,
  OutputConfig,
  SubAgentRuntimeOverrides,
  ModelConfig,
  RunConfig,
} from '../subagent.js';
import { ContextState, SubagentTerminateMode } from '../subagent.js';

// Use the types in typed positions to ensure they are not stripped
declare const _config: ModelConfig;
declare const _prompt: PromptConfig;
declare const _run: RunConfig;
declare const _tool: ToolConfig;
declare const _output: OutputConfig;
declare const _overrides: SubAgentRuntimeOverrides;
declare const _outputObj: OutputObject;
declare const _scope: SubAgentScopeType;

// Verify value exports are constructable / usable
const _ctx: ContextState = new ContextState();
const _mode: SubagentTerminateMode = SubagentTerminateMode.GOAL;

// Silence unused-variable warnings without the void operator
export {
  _config,
  _prompt,
  _run,
  _tool,
  _output,
  _overrides,
  _outputObj,
  _scope,
  _ctx,
  _mode,
};

// --- Additive type exports (uncomment in Phase 1 when available) ---
// import type { EnvironmentContextLoader } from '../subagent.js';
// import { defaultEnvironmentContextLoader, templateString } from '../subagent.js';
// declare const _envLoader: EnvironmentContextLoader;
// const _defaultLoader = defaultEnvironmentContextLoader;
// const _templateStr = templateString;
// export { _envLoader, _defaultLoader, _templateStr };
