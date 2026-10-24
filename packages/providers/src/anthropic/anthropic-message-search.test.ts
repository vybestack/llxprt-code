/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { RepairMessage } from './anthropic-repair-source.js';
import { repairMessageAt } from './anthropic-message-search.js';

describe('Anthropic message interval lookup', () => {
  it('selects the first matching slot across overlapping result and chain intervals', () => {
    const result: RepairMessage = {
      start: 1,
      end: 3,
      slot: 'results',
      role: 'user',
    };
    const chain: RepairMessage = {
      start: 1,
      end: 3,
      slot: 'chain',
      role: 'assistant',
    };
    const messages = [result, chain];
    for (const at of [1, 2, 3]) {
      expect(repairMessageAt(messages, at, 'results')).toBe(result);
      expect(repairMessageAt(messages, at, 'chain')).toBe(chain);
    }
    expect(repairMessageAt(messages, 0, 'results')).toBeUndefined();
    expect(repairMessageAt(messages, 4, 'chain')).toBeUndefined();
    expect(repairMessageAt(messages, 2, 'content')).toBeUndefined();
    expect(repairMessageAt([], 0, 'results')).toBeUndefined();
  });

  it('bounds header inspection when resolving a late row in a large request', () => {
    let inspections = 0;
    const messages = Array.from(
      { length: 8192 },
      (_, index): RepairMessage => ({
        get start() {
          inspections++;
          return index * 2;
        },
        get end() {
          inspections++;
          return index * 2;
        },
        get slot(): RepairMessage['slot'] {
          inspections++;
          return 'results';
        },
        role: 'user',
      }),
    );
    expect(repairMessageAt(messages, 16382, 'results')).toBe(messages[8191]);
    expect(inspections).toBeLessThan(32);
  });
});
