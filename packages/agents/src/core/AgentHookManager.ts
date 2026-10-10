/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  triggerBeforeAgentHook,
  triggerAfterAgentHook,
} from '@vybestack/llxprt-code-core/core/lifecycleHookTriggers.js';
import type {
  BeforeAgentHookOutput,
  AfterAgentHookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';

/**
 * Hook state for tracking BeforeAgent/AfterAgent deduplication.
 * Prevents multiple firings during recursive sendMessageStream calls.
 */
export interface HookState {
  hasFiredBeforeAgent: boolean;
  cumulativeResponse: string;
  activeCalls: number;
}

/**
 * Manages BeforeAgent/AfterAgent hook lifecycle with deduplication.
 * Tracks per-prompt hook state to prevent duplicate firings during
 * recursive sendMessageStream calls.
 */
export class AgentHookManager {
  private readonly hookStateMap: Map<string, HookState> = new Map();

  /**
   * Safely fire BeforeAgent hook with deduplication.
   * Only fires once per prompt_id regardless of recursive calls.
   */
  async fireBeforeAgentHookSafe(
    prompt_id: string,
    prompt: string,
    owner?: HookExecutionOwner,
  ): Promise<BeforeAgentHookOutput | undefined> {
    if (!this.hookStateMap.has(prompt_id)) {
      this.hookStateMap.set(prompt_id, {
        hasFiredBeforeAgent: false,
        cumulativeResponse: '',
        activeCalls: 0,
      });
    }

    const hookState = this.hookStateMap.get(prompt_id)!;
    hookState.activeCalls++;
    if (owner?.signal?.aborted === true) return undefined;

    if (!hookState.hasFiredBeforeAgent) {
      const result =
        owner === undefined
          ? await triggerBeforeAgentHook(prompt)
          : await triggerBeforeAgentHook(prompt, owner);
      hookState.hasFiredBeforeAgent = true;
      return result;
    }

    return undefined;
  }

  /**
   * Safely fire AfterAgent hook with deduplication.
   * Only fires on outermost call (activeCalls === 1) with cumulative response.
   */
  async fireAfterAgentHookSafe(
    prompt_id: string,
    prompt: string,
    responseChunk: string,
    hasPendingToolCalls: boolean,
    owner?: HookExecutionOwner,
  ): Promise<AfterAgentHookOutput | undefined> {
    const hookState = this.hookStateMap.get(prompt_id);
    if (!hookState) {
      return undefined;
    }

    hookState.cumulativeResponse += responseChunk;
    hookState.activeCalls--;
    if (owner?.signal?.aborted === true) return undefined;

    if (hookState.activeCalls === 0 && !hasPendingToolCalls) {
      return owner === undefined
        ? triggerAfterAgentHook(prompt, hookState.cumulativeResponse, false)
        : triggerAfterAgentHook(
            prompt,
            hookState.cumulativeResponse,
            false,
            owner,
          );
    }

    return undefined;
  }

  /**
   * Removes hook state for the old prompt_id when a new prompt arrives.
   * Preserves state for the current active prompt_id.
   */
  cleanupOldHookState(newPromptId: string, oldPromptId: string): void {
    if (oldPromptId !== newPromptId) {
      this.hookStateMap.delete(oldPromptId);
    }
  }
}
