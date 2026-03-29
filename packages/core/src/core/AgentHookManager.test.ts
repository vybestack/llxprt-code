/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentHookManager } from './AgentHookManager.js';

vi.mock('./lifecycleHookTriggers.js', () => ({
  triggerBeforeAgentHook: vi.fn(),
  triggerAfterAgentHook: vi.fn(),
}));

import {
  triggerBeforeAgentHook,
  triggerAfterAgentHook,
} from './lifecycleHookTriggers.js';

function makeConfig() {
  return {} as ConstructorParameters<typeof AgentHookManager>[0];
}

describe('AgentHookManager', () => {
  let manager: AgentHookManager;
  const mockBefore = triggerBeforeAgentHook as ReturnType<typeof vi.fn>;
  const mockAfter = triggerAfterAgentHook as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentHookManager(makeConfig());
  });

  describe('fireBeforeAgentHookSafe', () => {
    it('fires hook on first call for a prompt_id', async () => {
      mockBefore.mockResolvedValue(undefined);
      await manager.fireBeforeAgentHookSafe('p1', 'hello');
      expect(mockBefore).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        'hello',
      );
    });

    it('does not fire hook again for same prompt_id', async () => {
      mockBefore.mockResolvedValue(undefined);
      await manager.fireBeforeAgentHookSafe('p1', 'hello');
      const result2 = await manager.fireBeforeAgentHookSafe('p1', 'hello');
      expect(mockBefore).toHaveBeenCalledOnce();
      expect(result2).toBeUndefined();
    });

    it('fires hook for new prompt_id', async () => {
      mockBefore.mockResolvedValue(undefined);
      await manager.fireBeforeAgentHookSafe('p1', 'first');
      await manager.fireBeforeAgentHookSafe('p2', 'second');
      expect(mockBefore).toHaveBeenCalledTimes(2);
    });

    it('returns undefined when hook trigger returns undefined', async () => {
      mockBefore.mockResolvedValue(undefined);
      const result = await manager.fireBeforeAgentHookSafe('p1', 'test');
      expect(result).toBeUndefined();
    });

    it('returns hook output when hook trigger returns a value', async () => {
      const hookOutput = { someField: 'value' };
      mockBefore.mockResolvedValue(hookOutput);
      const result = await manager.fireBeforeAgentHookSafe('p1', 'test');
      expect(result).toStrictEqual(hookOutput);
    });

    it('increments activeCalls on each call', async () => {
      mockBefore.mockResolvedValue(undefined);
      await manager.fireBeforeAgentHookSafe('p1', 'first');
      await manager.fireBeforeAgentHookSafe('p1', 'second');
      await manager.fireBeforeAgentHookSafe('p1', 'third');
      // activeCalls should be 3
      // Fire after with 3 pending calls — should NOT fire yet
      mockAfter.mockResolvedValue(undefined);
      await manager.fireAfterAgentHookSafe('p1', 'first', 'r1', false);
      expect(mockAfter).not.toHaveBeenCalled(); // activeCalls was 3, now 2
      await manager.fireAfterAgentHookSafe('p1', 'first', 'r2', false);
      expect(mockAfter).not.toHaveBeenCalled(); // activeCalls was 2, now 1
      await manager.fireAfterAgentHookSafe('p1', 'first', 'r3', false);
      expect(mockAfter).toHaveBeenCalledOnce(); // activeCalls was 1, now 0
    });
  });

  describe('fireAfterAgentHookSafe', () => {
    it('fires hook and accumulates response text', async () => {
      mockBefore.mockResolvedValue(undefined);
      mockAfter.mockResolvedValue(undefined);
      await manager.fireBeforeAgentHookSafe('p1', 'prompt');
      await manager.fireAfterAgentHookSafe('p1', 'prompt', 'chunk1', false);
      expect(mockAfter).toHaveBeenCalledWith(
        expect.anything(),
        'prompt',
        'chunk1',
        false,
      );
    });

    it('returns undefined when no hook state exists for prompt_id', async () => {
      const result = await manager.fireAfterAgentHookSafe(
        'nonexistent',
        'prompt',
        'response',
        false,
      );
      expect(result).toBeUndefined();
      expect(mockAfter).not.toHaveBeenCalled();
    });

    it('deduplicates: does not fire when activeCalls > 0 after decrement', async () => {
      mockBefore.mockResolvedValue(undefined);
      // Fire before twice to make activeCalls=2
      await manager.fireBeforeAgentHookSafe('p1', 'p');
      await manager.fireBeforeAgentHookSafe('p1', 'p');
      // activeCalls = 2
      mockAfter.mockResolvedValue(undefined);
      const r1 = await manager.fireAfterAgentHookSafe(
        'p1',
        'p',
        'part1',
        false,
      );
      // activeCalls = 1, should not fire
      expect(mockAfter).not.toHaveBeenCalled();
      expect(r1).toBeUndefined();
    });

    it('fires only when activeCalls drops to zero', async () => {
      mockBefore.mockResolvedValue(undefined);
      await manager.fireBeforeAgentHookSafe('p1', 'p');
      await manager.fireBeforeAgentHookSafe('p1', 'p');
      // activeCalls = 2
      mockAfter.mockResolvedValue({ done: true });
      await manager.fireAfterAgentHookSafe('p1', 'p', 'part1', false);
      expect(mockAfter).not.toHaveBeenCalled();
      const result = await manager.fireAfterAgentHookSafe(
        'p1',
        'p',
        'part2',
        false,
      );
      expect(mockAfter).toHaveBeenCalledOnce();
      expect(result).toStrictEqual({ done: true });
    });

    it('does not fire when hasPendingToolCalls=true even at activeCalls=0', async () => {
      mockBefore.mockResolvedValue(undefined);
      await manager.fireBeforeAgentHookSafe('p1', 'p');
      mockAfter.mockResolvedValue(undefined);
      await manager.fireAfterAgentHookSafe('p1', 'p', 'resp', true);
      expect(mockAfter).not.toHaveBeenCalled();
    });

    it('accumulates response text across multiple calls', async () => {
      mockBefore.mockResolvedValue(undefined);
      await manager.fireBeforeAgentHookSafe('p1', 'p');
      await manager.fireBeforeAgentHookSafe('p1', 'p');
      // activeCalls = 2
      mockAfter.mockResolvedValue(undefined);
      await manager.fireAfterAgentHookSafe('p1', 'p', 'part1 ', false);
      await manager.fireAfterAgentHookSafe('p1', 'p', 'part2', false);
      // On the second call, activeCalls=0, fires with cumulative response
      expect(mockAfter).toHaveBeenCalledWith(
        expect.anything(),
        'p',
        'part1 part2',
        false,
      );
    });
  });

  describe('cleanupOldHookState', () => {
    it('removes hook state for old prompt_id', async () => {
      mockBefore.mockResolvedValue(undefined);
      await manager.fireBeforeAgentHookSafe('old', 'old prompt');
      manager.cleanupOldHookState('new', 'old');
      // After cleanup, afterHook returns undefined (no state)
      const result = await manager.fireAfterAgentHookSafe(
        'old',
        'old prompt',
        'resp',
        false,
      );
      expect(result).toBeUndefined();
      expect(mockAfter).not.toHaveBeenCalled();
    });

    it('does not remove state for current prompt_id', async () => {
      mockBefore.mockResolvedValue(undefined);
      mockAfter.mockResolvedValue(undefined);
      await manager.fireBeforeAgentHookSafe('current', 'current prompt');
      manager.cleanupOldHookState('current', 'current');
      // State should still exist for 'current'
      await manager.fireAfterAgentHookSafe(
        'current',
        'current prompt',
        'resp',
        false,
      );
      expect(mockAfter).toHaveBeenCalledOnce();
    });
  });

  describe('prompt-id lifecycle', () => {
    it('cleans up hook state for old prompt_id when new prompt arrives', async () => {
      mockBefore.mockResolvedValue(undefined);
      await manager.fireBeforeAgentHookSafe('prompt1', 'first prompt');
      manager.cleanupOldHookState('prompt2', 'prompt1');
      // Attempting to fire after for old prompt returns nothing
      const result = await manager.fireAfterAgentHookSafe(
        'prompt1',
        'first prompt',
        'resp',
        false,
      );
      expect(result).toBeUndefined();
    });

    it('preserves hook state for current active prompt_id', async () => {
      mockBefore.mockResolvedValue(undefined);
      mockAfter.mockResolvedValue({ continued: true });
      await manager.fireBeforeAgentHookSafe('active', 'active prompt');
      // Call cleanupOldHookState with same id (no-op)
      manager.cleanupOldHookState('active', 'active');
      const result = await manager.fireAfterAgentHookSafe(
        'active',
        'active prompt',
        'response',
        false,
      );
      expect(result).toStrictEqual({ continued: true });
    });
  });
});
