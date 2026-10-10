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
import type { HookExecutionOwner } from '../hooks/hookEventHandler.js';

const debugLogger = DebugLogger.getLogger(
  'llxprt:core:hook-triggers:lifecycle',
);

/**
 * Trigger SessionStart hook when a new session begins
 *
 * @param config - Configuration object with hook system access
 * @param source - The source of the session start (startup, resume, clear, compress)
 * @returns SessionStartHookOutput if hooks execute, undefined otherwise
 */
export async function triggerSessionStartHook(
  source: SessionStartSource,
  owner?: HookExecutionOwner,
): Promise<SessionStartHookOutput | undefined> {
  // Get the HookSystem singleton (null when hooks disabled or unavailable)
  if (owner === undefined) {
    return undefined;
  }

  owner.signal?.throwIfAborted();
  try {
    // Initialize hook system if needed

    // Fire the event using HookSystem facade
    const result = await owner.sessionStart?.(source, owner.signal);

    debugLogger.debug('SessionStart hook executed', { source });

    // Return SessionStartHookOutput from aggregated result
    if (result?.finalOutput) {
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
  reason: SessionEndReason,
  owner?: HookExecutionOwner,
): Promise<SessionEndHookOutput | undefined> {
  // Get the HookSystem singleton (null when hooks disabled or unavailable)
  if (owner === undefined) {
    return undefined;
  }

  owner.signal?.throwIfAborted();
  try {
    // Initialize hook system if needed

    // Fire the event using HookSystem facade
    const result = await owner.sessionEnd?.(reason, owner.signal);

    debugLogger.debug('SessionEnd hook executed', { reason });

    // Return SessionEndHookOutput from aggregated result
    if (result?.finalOutput) {
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
  prompt: string,
  owner?: HookExecutionOwner,
): Promise<BeforeAgentHookOutput | undefined> {
  // Get the HookSystem singleton (null when hooks disabled or unavailable)
  if (owner === undefined) {
    return undefined;
  }

  owner.signal?.throwIfAborted();
  try {
    // Initialize hook system if needed

    // Fire the event using HookSystem facade
    const result = await owner.beforeAgent?.(prompt, owner.signal);
    owner.signal?.throwIfAborted();

    debugLogger.debug('BeforeAgent hook executed');

    // Return BeforeAgentHookOutput from aggregated result
    if (result?.finalOutput) {
      return new BeforeAgentHookOutput(result.finalOutput);
    }

    return undefined;
  } catch (error) {
    owner.signal?.throwIfAborted();
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
  prompt: string,
  promptResponse: string,
  stopHookActive: boolean,
  owner?: HookExecutionOwner,
): Promise<AfterAgentHookOutput | undefined> {
  // Get the HookSystem singleton (null when hooks disabled or unavailable)
  if (owner === undefined) {
    return undefined;
  }

  owner.signal?.throwIfAborted();
  try {
    // Initialize hook system if needed

    // Fire the event using HookSystem facade
    const context = {
      prompt,
      prompt_response: promptResponse,
      stop_hook_active: stopHookActive,
    };
    const result = await owner.afterAgent?.(
      context.prompt,
      context.prompt_response,
      context.stop_hook_active,
      owner.signal,
    );

    debugLogger.debug('AfterAgent hook executed');

    // Return AfterAgentHookOutput from aggregated result
    if (result?.finalOutput) {
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
  trigger: PreCompressTrigger,
  owner?: HookExecutionOwner,
): Promise<PreCompressOutput | undefined> {
  // Get the HookSystem singleton (null when hooks disabled or unavailable)
  if (owner === undefined) {
    return undefined;
  }

  owner.signal?.throwIfAborted();
  try {
    // Initialize hook system if needed

    // Fire the event using HookSystem facade
    const result = await owner.preCompress?.(trigger, owner.signal);

    debugLogger.debug('PreCompress hook executed', { trigger });

    // Return PreCompressOutput from aggregated result
    if (result?.finalOutput) {
      return result.finalOutput as PreCompressOutput;
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block compression
    debugLogger.debug('PreCompress hook failed (non-blocking):', error);
    return undefined;
  }
}
