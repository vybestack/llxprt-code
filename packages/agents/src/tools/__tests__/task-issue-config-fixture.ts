import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { vi } from 'bun:test';
import { createSessionSettingsFixture } from '../../api/__tests__/helpers/session-settings-fixture.js';
import type { SubagentOrchestrator } from '../../core/subagentOrchestrator.js';
import { TaskTool, type TaskToolParams } from '../task.js';
import { createMockOrchestrator } from './task-orchestrator-fixture.js';
import { taskSelection } from './task-selection-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { afterEach } from 'bun:test';
import type { TaskToolDependencies } from '../task.js';

export function installTaskIssueConfigFixture(): (
  sessionId: string,
  ephemerals?: Record<string, unknown>,
) => Config {
  let roots: readonly Config[] = [];
  afterEach(async () => {
    const retiring = roots;
    roots = [];
    const results = await Promise.allSettled(
      retiring.map((root) => root.dispose()),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Task fixture Config cleanup failed');
    }
  });
  return (sessionId, ephemerals = {}) => {
    const root = new Config({
      sessionId,
      model: 'task-issues-fixture',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      trustedFolder: true,
      initialSettings: ephemerals,
    });
    roots = [...roots, root];
    return root;
  };
}

export function taskIssueSettingsDependencies(
  settingsOwner: SessionSettingsOwner,
  excludedTools: readonly string[],
): Pick<TaskToolDependencies, 'readTaskPolicy' | 'readGovernance'> {
  return {
    readTaskPolicy: () => settingsOwner.readTaskPolicy(),
    readGovernance: () => settingsOwner.readToolGovernance(excludedTools),
  };
}

export function qualifiedTaskInvocationFixture(
  createConfig: (
    sessionId: string,
    ephemerals?: Record<string, unknown>,
  ) => Config,
) {
  return async (
    params: Pick<TaskToolParams, 'tool_whitelist' | 'expected_outputs'>,
    registryTools = ['run_shell_command'],
    ephemerals: Record<string, unknown> = {},
  ): Promise<Parameters<SubagentOrchestrator['launch']>[0] | undefined> => {
    const config = createConfig('session-2184', ephemerals);
    const { settingsOwner } = createSessionSettingsFixture(config);
    const { orchestrator } = createMockOrchestrator('agent-2184');
    const launch = vi.spyOn(orchestrator, 'launch');
    const tool = new TaskTool(config, {
      ...taskIssueSettingsDependencies(
        settingsOwner,
        config.getExcludeTools() ?? [],
      ),
      toolRegistry: await taskSelection({
        getEnabledTools: () => registryTools.map((name) => ({ name })),
      }),
      messageBus: new MessageBus(),
      launchChild: (request, signal) => orchestrator.launch(request, signal),
      isInteractiveEnvironment: () => true,
    });
    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Do work',
      ...params,
    });
    await invocation.execute(new AbortController().signal, undefined);
    return launch.mock.calls[0]?.[0];
  };
}
