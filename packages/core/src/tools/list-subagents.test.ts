/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { ListSubagentsTool } from './list-subagents.js';
import type { Config } from '../config/config.js';
import type { SubagentManager } from '../config/subagentManager.js';

describe('ListSubagentsTool', () => {
  const createMockManager = (): SubagentManager =>
    ({
      listSubagents: vi.fn().mockResolvedValue([]),
      loadSubagent: vi.fn(),
    }) as unknown as SubagentManager;

  const buildConfig = (manager?: SubagentManager): Config =>
    ({
      getSubagentManager: () => manager,
    }) as unknown as Config;

  it('returns summaries for available subagents', async () => {
    const manager = createMockManager();
    vi.spyOn(manager, 'listSubagents').mockResolvedValue(['alpha']);
    vi.spyOn(manager, 'loadSubagent').mockImplementation(async () => ({
      name: 'alpha',
      profile: 'reviewer',
      systemPrompt:
        'Review code submissions for adherence to style guidelines.\nFocus on maintainability.',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-05T00:00:00Z',
    }));

    const tool = new ListSubagentsTool(buildConfig(manager));
    const invocation = tool.build({});
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.metadata).toEqual({ count: 1 });
    expect(result.llmContent).toContain('"name": "alpha"');
    expect(result.llmContent).toContain('"profile": "reviewer"');
    expect(result.returnDisplay).toContain('**alpha**');
    expect(result.returnDisplay).toContain('Review code submissions');
  });

  it('truncates long descriptions', async () => {
    const manager = createMockManager();
    vi.spyOn(manager, 'listSubagents').mockResolvedValue(['beta']);
    const longPrompt = 'A'.repeat(400);
    vi.spyOn(manager, 'loadSubagent').mockResolvedValue({
      name: 'beta',
      profile: 'helper',
      systemPrompt: longPrompt,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-05T00:00:00Z',
    });

    const tool = new ListSubagentsTool(buildConfig(manager));
    const invocation = tool.build({});
    const result = await invocation.execute(new AbortController().signal);

    expect(result.returnDisplay).toMatch(/A{159}…/);
  });

  it('handles missing subagents gracefully', async () => {
    const manager = createMockManager();
    vi.spyOn(manager, 'listSubagents').mockResolvedValue([]);

    const tool = new ListSubagentsTool(buildConfig(manager));
    const invocation = tool.build({});
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.metadata).toEqual({ count: 0 });
    expect(result.returnDisplay).toContain(
      'No subagents are currently registered',
    );
  });

  it('throws when SubagentManager is unavailable', () => {
    const tool = new ListSubagentsTool(buildConfig(undefined));
    expect(() => tool.build({})).toThrow(
      'SubagentManager service is unavailable. Please configure subagents before invoking this tool.',
    );
  });
});
