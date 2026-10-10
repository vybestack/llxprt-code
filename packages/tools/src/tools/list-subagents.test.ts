/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import { ListSubagentsTool } from './list-subagents.js';
import type { ISubagentCatalog, SubagentConfig } from '../interfaces/index.js';

describe('ListSubagentsTool', () => {
  const createMockService = (): ISubagentCatalog => ({
    listSubagents: vi.fn().mockResolvedValue([]),
    getSubagentConfig: vi.fn(),
  });

  it('returns summaries for available subagents', async () => {
    const service = createMockService();
    vi.spyOn(service, 'listSubagents').mockResolvedValue([{ name: 'alpha' }]);
    vi.spyOn(service, 'getSubagentConfig').mockResolvedValue({
      name: 'alpha',
      profile: 'reviewer',
      systemPrompt:
        'Review code submissions for adherence to style guidelines.\nFocus on maintainability.',
      updatedAt: '2025-01-05T00:00:00Z',
    } satisfies SubagentConfig);

    const tool = new ListSubagentsTool(service);
    const invocation = tool.build({});
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.metadata).toStrictEqual({ count: 1 });
    expect(result.llmContent).toContain('"name": "alpha"');
    expect(result.llmContent).toContain('"profile": "reviewer"');
    expect(result.returnDisplay).toContain('**alpha**');
    expect(result.returnDisplay).toContain('Review code submissions');
  });

  it('truncates long descriptions', async () => {
    const service = createMockService();
    vi.spyOn(service, 'listSubagents').mockResolvedValue([{ name: 'beta' }]);
    const longPrompt = 'A'.repeat(400);
    vi.spyOn(service, 'getSubagentConfig').mockResolvedValue({
      name: 'beta',
      profile: 'helper',
      systemPrompt: longPrompt,
      updatedAt: '2025-01-05T00:00:00Z',
    });

    const tool = new ListSubagentsTool(service);
    const invocation = tool.build({});
    const result = await invocation.execute(new AbortController().signal);

    expect(result.returnDisplay).toMatch(/A{159}…/);
  });

  it('handles missing subagents gracefully', async () => {
    const service = createMockService();
    vi.spyOn(service, 'listSubagents').mockResolvedValue([]);

    const tool = new ListSubagentsTool(service);
    const invocation = tool.build({});
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.metadata).toStrictEqual({ count: 0 });
    expect(result.returnDisplay).toContain(
      'No subagents are currently registered',
    );
  });

  it('surfaces catalog listing failures rather than reporting an empty list', async () => {
    const service = createMockService();
    vi.spyOn(service, 'listSubagents').mockRejectedValue(
      new Error('Directory unavailable'),
    );
    await expect(new ListSubagentsTool(service).execute({})).rejects.toThrow(
      'Directory unavailable',
    );
  });
});
