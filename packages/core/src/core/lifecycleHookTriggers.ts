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
 * These functions follow the same pattern as geminiChatHookTriggers.ts
 */

import type { Config } from '../config/config.js';
import {
  SessionStartSource,
  SessionEndReason,
  SessionStartHookOutput,
  SessionEndHookOutput,
  BeforeAgentHookOutput,
  AfterAgentHookOutput,
} from '../hooks/types.js';
import { DebugLogger } from '../debug/index.js';

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
  config: Config,
  source: SessionStartSource,
): Promise<SessionStartHookOutput | undefined> {
  // Check if hooks are enabled
  if (!config.getEnableHooks?.()) {
    return undefined;
  }

  // Get the HookSystem singleton
  const hookSystem = config.getHookSystem?.();
  if (!hookSystem) {
    return undefined;
  }

  try {
    // Initialize hook system if needed
    await hookSystem.initialize();

    // Get the event handler and fire the event
    const eventHandler = hookSystem.getEventHandler();
    const result = await eventHandler.fireSessionStartEvent({ source });

    debugLogger.debug('SessionStart hook executed', { source });

    // Return SessionStartHookOutput from aggregated result
    if (result.finalOutput) {
      return new SessionStartHookOutput(result.finalOutput);
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block session start
    debugLogger.warn('SessionStart hook failed (non-blocking):', error);
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
  // Check if hooks are enabled
  if (!config.getEnableHooks?.()) {
    return undefined;
  }

  // Get the HookSystem singleton
  const hookSystem = config.getHookSystem?.();
  if (!hookSystem) {
    return undefined;
  }

  try {
    // Initialize hook system if needed
    await hookSystem.initialize();

    // Get the event handler and fire the event
    const eventHandler = hookSystem.getEventHandler();
    const result = await eventHandler.fireSessionEndEvent({ reason });

    debugLogger.debug('SessionEnd hook executed', { reason });

    // Return SessionEndHookOutput from aggregated result
    if (result.finalOutput) {
      return new SessionEndHookOutput(result.finalOutput);
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block session end
    debugLogger.warn('SessionEnd hook failed (non-blocking):', error);
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
  // Check if hooks are enabled
  if (!config.getEnableHooks?.()) {
    return undefined;
  }

  // Get the HookSystem singleton
  const hookSystem = config.getHookSystem?.();
  if (!hookSystem) {
    return undefined;
  }

  try {
    // Initialize hook system if needed
    await hookSystem.initialize();

    // Get the event handler and fire the event
    const eventHandler = hookSystem.getEventHandler();
    const result = await eventHandler.fireBeforeAgentEvent({ prompt });

    debugLogger.debug('BeforeAgent hook executed');

    // Return BeforeAgentHookOutput from aggregated result
    if (result.finalOutput) {
      return new BeforeAgentHookOutput(result.finalOutput);
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block agent execution
    debugLogger.warn('BeforeAgent hook failed (non-blocking):', error);
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
  // Check if hooks are enabled
  if (!config.getEnableHooks?.()) {
    return undefined;
  }

  // Get the HookSystem singleton
  const hookSystem = config.getHookSystem?.();
  if (!hookSystem) {
    return undefined;
  }

  try {
    // Initialize hook system if needed
    await hookSystem.initialize();

    // Get the event handler and fire the event
    const eventHandler = hookSystem.getEventHandler();
    const result = await eventHandler.fireAfterAgentEvent({
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
    debugLogger.warn('AfterAgent hook failed (non-blocking):', error);
    return undefined;
  }
}
