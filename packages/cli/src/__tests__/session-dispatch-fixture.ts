/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOperations } from '../runtime/createRuntimeOwnerFeatures.js';
import {
  type LlxprtExtension,
  type WorkspaceSkillOperations,
  type Config,
} from '@vybestack/llxprt-code-core';

import type { Agent } from '@vybestack/llxprt-code-agents';
import { type LoadedSettings } from '../config/settings.js';
import { getUserStartupWarnings } from '../utils/userStartupWarnings.js';

import { validateNonInteractiveAuth } from '../validateNonInteractiveAuth.js';
import { runExitCleanup } from '../utils/cleanup.js';
import { reportNonInteractiveError } from '../session/errorReporting.js';
import { startInteractiveUIForTest } from './raw-interactive-startup-fixture.js';

import { captureNonInteractiveRun } from './captured-headless-run-fixture.js';
import {
  dispatchInteractiveOrNonInteractive as executeSessionDispatch,
  runPipedOrPromptSession,
  type ValidatedNonInteractiveRun,
} from '../session/nonInteractiveSession.js';
export interface SessionDispatchOptions {
  readonly runtimeSettings: SessionSettingsOperations;
  restartExtension?: (extension: LlxprtExtension) => Promise<void>;
  skillOperations?: Pick<
    WorkspaceSkillOperations,
    'list' | 'find' | 'reload' | 'isAdminEnabled'
  >;
  config: Config;
  /**
   * The single session Agent created at the CLI composition root (#2378). It is
   * threaded into the interactive UI and reused by the non-interactive run; the
   * session MessageBus is read from `agent.getMessageBus()` rather than passed
   * separately. The composition root owns the Agent's lifecycle (dispose on
   * cleanup).
   */
  agent: Agent;
  settings: LoadedSettings;
  workspaceRoot: string;
  recordingOwner?: 'agent';
  resumedBoot?:
    | Parameters<typeof startInteractiveUIForTest>[5]['resumedBoot']
    | null;
  /** Session-resume warnings the user must see (unreadable recordings, resume failures). */
  recordingStartupWarnings?: readonly string[];
  hasPipedInput: boolean;
  readStdinData: () => Promise<string>;
  suppressStartupWelcome?: boolean;
}
export function createSessionDispatch(
  options: SessionDispatchOptions,
): () => Promise<void> {
  return async () => {
    const {
      config,
      agent,
      settings,
      runtimeSettings,
      recordingOwner,
      workspaceRoot,
      resumedBoot,
      skillOperations,
      restartExtension,
      suppressStartupWelcome,
    } = options;
    const input = config.getQuestion();
    await executeSessionDispatch(
      input,
      () =>
        typeof config.isInteractive === 'function' && config.isInteractive(),
      recordingOwner,
      options.recordingStartupWarnings ?? [],
      () => getUserStartupWarnings(settings.merged),
      async (warnings) => {
        await startInteractiveUIForTest(
          config,
          agent,
          settings,
          warnings,
          workspaceRoot,
          {
            recordingOwner: 'agent',
            runtimeSettings,
            skillOperations,
            restartExtension,
            resumedBoot: resumedBoot ?? undefined,
            suppressStartupWelcome,
          },
        );
      },
      () => config.getOutputFormat(),
      (initialInput) =>
        runPipedOrPromptSession(
          initialInput,
          options.hasPipedInput,
          options.readStdinData,
          () => validateRun(config, agent, settings, runtimeSettings),
          agent.hooks.triggerSessionStart.bind(agent.hooks),
          agent.hooks.triggerSessionEnd.bind(agent.hooks),
          (error) => reportNonInteractiveError(config, error),
          () => runtimeSettings.flushTelemetry(),
        ),
    );
  };
}
async function validateRun(
  config: Config,
  agent: Agent,
  settings: LoadedSettings,
  owner: SessionSettingsOperations,
): Promise<ValidatedNonInteractiveRun> {
  const validated = await validateNonInteractiveAuth(
    settings.merged.useExternalAuth,
    config,
    settings,
    runExitCleanup,
    agent.hasActiveProvider,
    (key, value) => agent.setEphemeralSetting(key, value),
  );
  return {
    run: captureNonInteractiveRun(validated, agent, true, () =>
      owner.flushTelemetry(),
    ),
    report: (error) => reportNonInteractiveError(validated, error),
  };
}

export async function dispatchInteractiveOrNonInteractive(
  options: SessionDispatchOptions,
): Promise<void> {
  await createSessionDispatch(options)();
}
