/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeLoaderResult } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { ChildAgentScope } from '../../subagentOrchestrator.js';
import { createSubagentScope } from '../helpers/create-subagent-scope.js';
import {
  installSubagentCleanup,
  seedSubagentSettings,
  createSubagentConfig,
  acquireSubagentSettings,
  acquireSubagentWorkspace,
  createRuntimeOverrides,
  createStatelessRuntimeBundle,
  defaultModelConfig,
  defaultRunConfig,
  scopeInputs,
} from '../subagent-test-helpers.js';

const retainCleanup = installSubagentCleanup();

export async function createIdleScope(
  timeoutMs: number,
  agentName: string,
  systemPrompt: string,
  maxTimeMinutes = defaultRunConfig.max_time_minutes,
): Promise<{
  config: Config;
  scope: ChildAgentScope;
  runtimeBundle: AgentRuntimeLoaderResult;
}> {
  const settings = seedSubagentSettings({
    'stream-idle-timeout-ms': timeoutMs,
  });
  const config = createSubagentConfig(settings, retainCleanup);
  await acquireSubagentSettings(config, settings, retainCleanup);
  const workspace = await acquireSubagentWorkspace(config, retainCleanup);
  const runtimeBundle = createStatelessRuntimeBundle({ settings });
  const { overrides } = createRuntimeOverrides(workspace.workspacePaths, {
    runtimeBundle,
    settings,
  });
  const scope = await createSubagentScope(
    {
      name: agentName,
      prompt: { systemPrompt },
      model: defaultModelConfig,
      run: { ...defaultRunConfig, max_time_minutes: maxTimeMinutes },
      toolConfig: undefined,
      outputConfig: undefined,
    },
    ...scopeInputs(config, overrides),
  );
  retainCleanup(() => scope.dispose());
  return { config, scope, runtimeBundle };
}
