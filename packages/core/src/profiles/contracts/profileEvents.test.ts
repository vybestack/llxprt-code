/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { toRedactedProfileEvent } from './profileEvents.js';

describe('toRedactedProfileEvent', () => {
  it('preserves all factual fields', () => {
    const event = {
      type: 'committed' as const,
      agentId: 'agent-1',
      commandKind: 'set' as const,
      revision: 7,
      at: 1_700_000_000_000,
    };
    const redacted = toRedactedProfileEvent(event);
    expect(redacted.type).toBe('committed');
    expect(redacted.agentId).toBe('agent-1');
    expect(redacted.commandKind).toBe('set');
    expect(redacted.revision).toBe(7);
    expect(redacted.at).toBe(1_700_000_000_000);
  });

  it('preserves a null commandKind', () => {
    const event = {
      type: 'health-changed' as const,
      agentId: 'agent-1',
      commandKind: null,
      revision: 3,
      at: 42,
    };
    const redacted = toRedactedProfileEvent(event);
    expect(redacted.commandKind).toBeNull();
  });

  it('returns a deeply frozen object', () => {
    const event = {
      type: 'command-queued' as const,
      agentId: 'agent-2',
      commandKind: 'load' as const,
      revision: 4,
      at: 99,
    };
    const redacted = toRedactedProfileEvent(event);
    expect(Object.isFrozen(redacted)).toBe(true);
    expect(() => {
      (redacted as Record<string, unknown>)['agentId'] = 'changed';
    }).toThrow(TypeError);
  });
});
