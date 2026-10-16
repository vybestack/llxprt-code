/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CliUiRuntime } from '../cliUiRuntime.js';
import { useMemo } from 'react';
import { createHooksCommand } from '../commands/hooksCommand.js';
import { createTaskCommand } from '../commands/tasksCommand.js';
import { createToolsCommand } from '../commands/toolsCommand.js';
import { createDirectoryCommand } from '../commands/directoryCommand.js';
import { bindDirectoryCommand } from '../commands/directoryCommandHost.js';
import { createMemoryCommand } from '../commands/memoryCommand.js';
import { bindMemoryCommand } from '../commands/memoryCommandHost.js';
import { createImageCommand } from '../commands/imageCommand.js';
import { bindImageCommand } from '../commands/imageCommandHost.js';
import { createBugCommand } from '../commands/bugCommand.js';
import { bindBugCommand } from '../commands/bugCommandHost.js';
import { createPoliciesCommand } from '../commands/policiesCommand.js';
import { bindPoliciesCommand } from '../commands/policiesCommandHost.js';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { SlashCommand } from '../commands/types.js';
function useDirectoryCommandOwner(
  config: CliUiRuntime | null,
  agent: Agent | null,
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingIntegration: RecordingIntegration | undefined,
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
): SlashCommand {
  return useMemo(
    () =>
      createDirectoryCommand(
        bindDirectoryCommand(
          config,
          agent,
          recordingOwner,
          recordingIntegration,
          addItem,
          setMemoryFileCount,
        ),
      ),
    [
      config,
      agent,
      recordingOwner,
      recordingIntegration,
      addItem,
      setMemoryFileCount,
    ],
  );
}

function useBugCommandOwner(
  config: CliUiRuntime | null,
  agent: Agent | null,
  addItem: UseHistoryManagerReturn['addItem'],
): SlashCommand {
  return useMemo(
    () => createBugCommand(bindBugCommand(config, agent, addItem)),
    [config, agent, addItem],
  );
}

function useMemoryCommandOwner(
  config: CliUiRuntime | null,
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
): SlashCommand {
  return useMemo(
    () =>
      createMemoryCommand(
        bindMemoryCommand(config, addItem, setMemoryFileCount),
      ),
    [config, addItem, setMemoryFileCount],
  );
}

export function useWorkspaceCommandOwners(
  config: CliUiRuntime | null,
  agent: Agent | null,
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingIntegration: RecordingIntegration | undefined,
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
) {
  const memoryCommand = useMemoryCommandOwner(
    config,
    addItem,
    setMemoryFileCount,
  );
  const policiesCommand = useMemo(() => {
    const policy = agent?.policy;
    return createPoliciesCommand(
      policy === undefined
        ? { getPolicyInfo: () => null }
        : bindPoliciesCommand(
            policy.getRules.bind(policy),
            policy.getDefaultDecision.bind(policy),
            policy.isNonInteractive.bind(policy),
          ),
    );
  }, [agent]);
  return {
    memoryCommand,
    bugCommand: useBugCommandOwner(config, agent, addItem),
    policiesCommand,
    hooksCommand: useMemo(
      () =>
        createHooksCommand(
          {
            listHooks: () => agent?.hooks.listHooks() ?? [],
            isConfigured: config !== null,
            isAvailable: agent !== null,
            enable: (name) => {
              if (agent === null) throw new Error('Hook owner unavailable');
              agent.hooks.enable(name);
            },
            disable: (name) => {
              if (agent === null) throw new Error('Hook owner unavailable');
              agent.hooks.disable(name);
            },
            setDisabledHooks: (names) => {
              if (agent === null) throw new Error('Hook owner unavailable');
              agent.hooks.setDisabledHooks(names);
            },
          },
          addItem,
        ),
      [agent, config, addItem],
    ),
    taskCommand: useMemo(
      () =>
        createTaskCommand(
          agent === null
            ? null
            : {
                list: () => agent.tasks.list(),
                listRunning: () => agent.tasks.listRunning(),
                get: (id) => agent.tasks.get(id),
                cancel: (id) => agent.tasks.cancel(id),
              },
          addItem,
        ),
      [agent, addItem],
    ),
    toolsCommand: useToolsCommandOwner(agent, addItem),
    directoryCommand: useDirectoryCommandOwner(
      config,
      agent,
      recordingOwner,
      recordingIntegration,
      addItem,
      setMemoryFileCount,
    ),
    imageCommand: useImageCommandOwner(config, agent, addItem),
  };
}

function useImageCommandOwner(
  config: CliUiRuntime | null,
  agent: Agent | null,
  addItem: UseHistoryManagerReturn['addItem'],
): SlashCommand {
  return useMemo(
    () => createImageCommand(bindImageCommand(config, agent, addItem)),
    [config, agent, addItem],
  );
}

function useToolsCommandOwner(
  agent: Agent | null,
  addItem: UseHistoryManagerReturn['addItem'],
): SlashCommand {
  return useMemo(
    () =>
      createToolsCommand(
        agent === null
          ? null
          : {
              listTools: () => agent.tools.list(),
              readSetting: (key) => agent.getEphemeralSetting(key),
              writeSetting: (key, value) =>
                agent.setEphemeralSetting(key, value),
              refreshToolSchema: () => agent.agentClient.setTools(),
            },
        addItem,
      ),
    [agent, addItem],
  );
}
