/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { AsyncTaskManager } from '../services/asyncTaskManager.js';
import {
  createToolRegistry,
  type ToolRegistryHost,
} from './toolRegistryFactory.js';
import type { ProfileManager } from './profileManager.js';
import type { SubagentManager } from './subagentManager.js';

function createHost(options: {
  asyncTaskManager?: AsyncTaskManager;
  subagentManager?: SubagentManager;
  profileManager?: ProfileManager;
}): ToolRegistryHost {
  let profileManager = options.profileManager;
  let subagentManager = options.subagentManager;
  return {
    getCoreTools: () => ['TaskTool', 'ListSubagentsTool', 'check_async_tasks'],
    getExcludeTools: () => [],
    getUseRipgrep: () => false,
    getProfileManager: () => profileManager,
    setProfileManager: (pm: ProfileManager) => {
      profileManager = pm;
    },
    getSubagentManager: () => subagentManager,
    setSubagentManager: (sm: SubagentManager) => {
      subagentManager = sm;
    },
    getInteractiveSubagentSchedulerFactory: () => undefined,
    getAsyncTaskManager: () => options.asyncTaskManager,
  };
}

function createConfigBoundary(): Record<string, unknown> {
  return {
    getCoreTools: () => ['TaskTool', 'ListSubagentsTool', 'check_async_tasks'],
    getExcludeTools: () => [],
    getToolDiscoveryCommand: () => undefined,
    getToolCallCommand: () => undefined,
    getPromptRegistry: () => undefined,
    getSettingsService: () => undefined,
    getEphemeralSettings: () => ({}),
    isToolEnabled: () => true,
    isTrustedFolder: () => false,
    isInteractive: () => false,
  };
}

describe('toolRegistryFactory adapter-backed runtime tools', () => {
  it('registers ListSubagentsTool through CoreSubagentServiceAdapter so registry invocation can list subagents', async () => {
    const subagentManager = {
      getCachedSubagentNames: vi.fn().mockReturnValue(['alpha']),
      getCachedSubagentConfig: vi.fn().mockReturnValue({
        name: 'alpha',
        profile: 'reviewer',
        systemPrompt: 'Review TypeScript migration boundaries.',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      }),
      listSubagents: vi.fn().mockResolvedValue([]),
    } as unknown as SubagentManager;

    const { registry } = await createToolRegistry(
      createHost({
        profileManager: {} as ProfileManager,
        subagentManager,
      }),
      createConfigBoundary(),
      new MessageBus(),
    );

    const tool = registry.getTool('list_subagents');
    expect(tool).toBeDefined();
    const result = await tool!.build({}).execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('"name": "alpha"');
    expect(result.returnDisplay).toContain('Review TypeScript migration');
  });

  it('registers CheckAsyncTasksTool through CoreAsyncTaskServiceAdapter so registry invocation can inspect async tasks', async () => {
    const asyncTaskManager = new AsyncTaskManager(5);
    asyncTaskManager.registerTask({
      id: 'task-registry-adapter',
      subagentName: 'typescriptexpert',
      goalPrompt: 'Verify registry wiring',
      abortController: new AbortController(),
    });

    const { registry } = await createToolRegistry(
      createHost({ asyncTaskManager }),
      createConfigBoundary(),
      new MessageBus(),
    );

    const tool = registry.getTool('check_async_tasks');
    expect(tool).toBeDefined();
    const result = await tool!.build({}).execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Async Tasks Summary');
    expect(result.llmContent).toContain('task-registry-adapter');
  });
});
