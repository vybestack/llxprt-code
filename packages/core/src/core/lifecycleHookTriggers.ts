/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P12,P13,P14,P20
 * @requirement:HOOK-033,HOOK-034,HOOK-035,HOOK-041,HOOK-042,HOOK-043,HOOK-044,HOOK-045
 * @pseudocode:analysis/pseudocode/04-model-hook-pipeline.md
 *
 * Lifecycle hook trigger functions (SessionStart, SessionEnd, BeforeAgent, AfterAgent)
 * These functions follow the same pattern as coreToolHookTriggers.ts
 */

import type { Config } from '../config/config.js';
import type {
  SessionStartSource,
  SessionEndReason,
  PreCompressTrigger,
  PreCompressOutput,
} from '../hooks/types.js';
import {
  SessionStartHookOutput,
  SessionEndHookOutput,
  BeforeAgentHookOutput,
  AfterAgentHookOutput,
} from '../hooks/types.js';
import { DebugLogger } from '../debug/index.js';
import type { HookSystem } from '../hooks/hookSystem.js';
import type { HookConfigBoundary } from './hookConfigBoundary.js';

const debugLogger = DebugLogger.getLogger(
  'llxprt:core:hook-triggers:lifecycle',
);

/**
 * Returns the active HookSystem (or null) when hooks are enabled.
 * Handles config test doubles that may not implement hook accessors.
 */
function getEnabledHookSystem(config: HookConfigBoundary): HookSystem | null {
  const enabled = config.getEnableHooks?.();
  if (enabled !== true) {
    return null;
  }
  const hookSystem = config.getHookSystem?.();
  if (hookSystem === undefined) {
    return null;
  }
  return hookSystem;
}

/**
 * Trigger SessionStart hook when a new session begins
 *
 * @param config - Configuration object with hook system access
 * @param source - The source of the session start (startup, resume, clear, compress)
 * @returns SessionStartHookOutput if hooks execute, undefined otherwise
 */
export async function triggerSessionStartHook(
  config: Config,
  source: SessionStartSource,
): Promise<SessionStartHookOutput | undefined> {
  // Get the HookSystem singleton (null when hooks disabled or unavailable)
  const hookSystem = getEnabledHookSystem(config);
  if (!hookSystem) {
    return undefined;
  }

  try {
    // Initialize hook system if needed
    await hookSystem.initialize();

    // Fire the event using HookSystem facade
    const result = await hookSystem.fireSessionStartEvent({ source });

    debugLogger.debug('SessionStart hook executed', { source });

    // Return SessionStartHookOutput from aggregated result
    if (result.finalOutput) {
      return new SessionStartHookOutput(result.finalOutput);
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block session start
    debugLogger.debug('SessionStart hook failed (non-blocking):', error);
    return undefined;
  }
}

/**
 * Trigger SessionEnd hook when a session ends
 *
 * @param config - Configuration object with hook system access
 * @param reason - The reason for the session end (exit, clear, logout, etc.)
 * @returns SessionEndHookOutput if hooks execute, undefined otherwise
 */
export async function triggerSessionEndHook(
  config: Config,
  reason: SessionEndReason,
): Promise<SessionEndHookOutput | undefined> {
  // Get the HookSystem singleton (null when hooks disabled or unavailable)
  const hookSystem = getEnabledHookSystem(config);
  if (!hookSystem) {
    return undefined;
  }

  try {
    // Initialize hook system if needed
    await hookSystem.initialize();

    // Fire the event using HookSystem facade
    const result = await hookSystem.fireSessionEndEvent({ reason });

    debugLogger.debug('SessionEnd hook executed', { reason });

    // Return SessionEndHookOutput from aggregated result
    if (result.finalOutput) {
      return new SessionEndHookOutput(result.finalOutput);
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block session end
    debugLogger.debug('SessionEnd hook failed (non-blocking):', error);
    return undefined;
  }
}

/**
 * Trigger BeforeAgent hook at the start of a turn (before model call)
 *
 * @param config - Configuration object with hook system access
 * @param prompt - The user prompt for this turn
 * @returns BeforeAgentHookOutput if hooks execute, undefined otherwise
 */
export async function triggerBeforeAgentHook(
  config: Config,
  prompt: string,
): Promise<BeforeAgentHookOutput | undefined> {
  // Get the HookSystem singleton (null when hooks disabled or unavailable)
  const hookSystem = getEnabledHookSystem(config);
  if (!hookSystem) {
    return undefined;
  }

  try {
    // Initialize hook system if needed
    await hookSystem.initialize();

    // Fire the event using HookSystem facade
    const result = await hookSystem.fireBeforeAgentEvent({ prompt });

    debugLogger.debug('BeforeAgent hook executed');

    // Return BeforeAgentHookOutput from aggregated result
    if (result.finalOutput) {
      return new BeforeAgentHookOutput(result.finalOutput);
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block agent execution
    debugLogger.debug('BeforeAgent hook failed (non-blocking):', error);
    return undefined;
  }
}

/**
 * Trigger AfterAgent hook at the end of a turn (after all tool calls complete)
 *
 * @param config - Configuration object with hook system access
 * @param prompt - The original user prompt
 * @param promptResponse - The agent's response
 * @param stopHookActive - Whether a stop hook is currently active
 * @returns AfterAgentHookOutput if hooks execute, undefined otherwise
 */
export async function triggerAfterAgentHook(
  config: Config,
  prompt: string,
  promptResponse: string,
  stopHookActive: boolean,
): Promise<AfterAgentHookOutput | undefined> {
  // Get the HookSystem singleton (null when hooks disabled or unavailable)
  const hookSystem = getEnabledHookSystem(config);
  if (!hookSystem) {
    return undefined;
  }

  try {
    // Initialize hook system if needed
    await hookSystem.initialize();

    // Fire the event using HookSystem facade
    const result = await hookSystem.fireAfterAgentEvent({
      prompt,
      prompt_response: promptResponse,
      stop_hook_active: stopHookActive,
    });

    debugLogger.debug('AfterAgent hook executed');

    // Return AfterAgentHookOutput from aggregated result
    if (result.finalOutput) {
      return new AfterAgentHookOutput(result.finalOutput);
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block agent execution
    debugLogger.debug('AfterAgent hook failed (non-blocking):', error);
    return undefined;
  }
}

/**
 * Trigger PreCompress hook before chat compression
 *
 * @plan PLAN-20250219-GMERGE021.R4.P02
 * @requirement REQ-P02-1
 *
 * @param config - Configuration object with hook system access
 * @param trigger - The trigger type (manual or auto)
 * @returns PreCompressOutput if hooks execute, undefined otherwise
 */
export async function triggerPreCompressHook(
  config: Config,
  trigger: PreCompressTrigger,
): Promise<PreCompressOutput | undefined> {
  // Get the HookSystem singleton (null when hooks disabled or unavailable)
  const hookSystem = getEnabledHookSystem(config);
  if (!hookSystem) {
    return undefined;
  }

  try {
    // Initialize hook system if needed
    await hookSystem.initialize();

    // Fire the event using HookSystem facade
    const result = await hookSystem.firePreCompressEvent({ trigger });

    debugLogger.debug('PreCompress hook executed', { trigger });

    // Return PreCompressOutput from aggregated result
    if (result.finalOutput) {
      return result.finalOutput as PreCompressOutput;
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block compression
    debugLogger.debug('PreCompress hook failed (non-blocking):', error);
    return undefined;
  }
}
