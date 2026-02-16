/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  shouldIncludeSubagentDelegation,
  shouldIncludeAsyncSubagentGuidance,
} from './subagent-delegation.js';
import type { SubagentManager } from '../config/subagentManager.js';

describe('shouldIncludeSubagentDelegation', () => {
  it('returns true when Task and ListSubagents tools are enabled and subagents exist', async () => {
    const mockSubagentManager = {
      listSubagents: vi.fn().mockResolvedValue([{ name: 'helper' }]),
    } as unknown as SubagentManager;

    const result = await shouldIncludeSubagentDelegation(
      ['task', 'list_subagents', 'read_file'],
      () => mockSubagentManager,
    );

    expect(result).toBe(true);
  });

  it('returns false when Task tool is not in enabled tools', async () => {
    const mockSubagentManager = {
      listSubagents: vi.fn().mockResolvedValue([{ name: 'helper' }]),
    } as unknown as SubagentManager;

    const result = await shouldIncludeSubagentDelegation(
      ['list_subagents', 'read_file'],
      () => mockSubagentManager,
    );

    expect(result).toBe(false);
  });

  it('returns false when ListSubagents tool is not in enabled tools', async () => {
    const mockSubagentManager = {
      listSubagents: vi.fn().mockResolvedValue([{ name: 'helper' }]),
    } as unknown as SubagentManager;

    const result = await shouldIncludeSubagentDelegation(
      ['task', 'read_file'],
      () => mockSubagentManager,
    );

    expect(result).toBe(false);
  });

  it('returns false when no subagents are available', async () => {
    const mockSubagentManager = {
      listSubagents: vi.fn().mockResolvedValue([]),
    } as unknown as SubagentManager;

    const result = await shouldIncludeSubagentDelegation(
      ['task', 'list_subagents'],
      () => mockSubagentManager,
    );

    expect(result).toBe(false);
  });

  it('returns false when SubagentManager is undefined', async () => {
    const result = await shouldIncludeSubagentDelegation(
      ['task', 'list_subagents'],
      () => undefined,
    );

    expect(result).toBe(false);
  });
});

describe('shouldIncludeAsyncSubagentGuidance', () => {
  it('returns true when all conditions are met', async () => {
    const result = await shouldIncludeAsyncSubagentGuidance(
      true, // includeSubagentDelegation
      true, // globalAsyncEnabled
      true, // profileAsyncEnabled
    );

    expect(result).toBe(true);
  });

  it('returns false when includeSubagentDelegation is false', async () => {
    const result = await shouldIncludeAsyncSubagentGuidance(
      false, // includeSubagentDelegation
      true, // globalAsyncEnabled
      true, // profileAsyncEnabled
    );

    expect(result).toBe(false);
  });

  it('returns false when globalAsyncEnabled is false', async () => {
    const result = await shouldIncludeAsyncSubagentGuidance(
      true, // includeSubagentDelegation
      false, // globalAsyncEnabled
      true, // profileAsyncEnabled
    );

    expect(result).toBe(false);
  });

  it('returns false when profileAsyncEnabled is false', async () => {
    const result = await shouldIncludeAsyncSubagentGuidance(
      true, // includeSubagentDelegation
      true, // globalAsyncEnabled
      false, // profileAsyncEnabled
    );

    expect(result).toBe(false);
  });

  it('returns false when all conditions are false', async () => {
    const result = await shouldIncludeAsyncSubagentGuidance(
      false, // includeSubagentDelegation
      false, // globalAsyncEnabled
      false, // profileAsyncEnabled
    );

    expect(result).toBe(false);
  });

  it('returns false when only globalAsyncEnabled is true', async () => {
    const result = await shouldIncludeAsyncSubagentGuidance(
      false, // includeSubagentDelegation
      true, // globalAsyncEnabled
      false, // profileAsyncEnabled
    );

    expect(result).toBe(false);
  });

  it('returns false when only profileAsyncEnabled is true', async () => {
    const result = await shouldIncludeAsyncSubagentGuidance(
      false, // includeSubagentDelegation
      false, // globalAsyncEnabled
      true, // profileAsyncEnabled
    );

    expect(result).toBe(false);
  });

  it('returns false when globalAsyncEnabled and profileAsyncEnabled are true but includeSubagentDelegation is false', async () => {
    const result = await shouldIncludeAsyncSubagentGuidance(
      false, // includeSubagentDelegation
      true, // globalAsyncEnabled
      true, // profileAsyncEnabled
    );

    expect(result).toBe(false);
  });
});
