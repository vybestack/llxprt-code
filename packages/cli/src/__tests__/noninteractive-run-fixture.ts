/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Config } from '@vybestack/llxprt-code-core';
import type {
  Agent,
  ProviderActivationIntent,
} from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import { activateConfiguredProvider } from '../cliProviderInit.js';
import type { ParsedCliArgs } from '../cliBootstrap.js';
import type { SessionSettingsOperations } from '../runtime/createRuntimeOwnerFeatures.js';
import { captureNonInteractiveRun } from './captured-headless-run-fixture.js';
import { acquireNonInteractiveRun } from '../nonInteractiveCliAcquisition.js';
interface RunNonInteractiveParams {
  readonly acquireAgent?: () => Promise<Agent>;
  readonly hasActiveProvider?: () => boolean;
  readonly isTrustedFolder?: () => boolean;
  runtimeSettings?: SessionSettingsOperations;
  config: Config;
  settings: LoadedSettings;
  input: string;
  prompt_id: string;
  deferTelemetryShutdown?: boolean;
  agent?: Agent;
}
export async function runNonInteractive(
  params: RunNonInteractiveParams,
): Promise<void> {
  const selected = (): SessionSettingsOperations => {
    if (params.runtimeSettings === undefined)
      throw new Error(
        'Noninteractive settings commands require the explicit session owner',
      );
    return params.runtimeSettings;
  };
  const run =
    params.agent === undefined
      ? acquireNonInteractiveRun(
          params.config,
          params.runtimeSettings !== undefined,
          () => selected().readNamedParameter('emojifilter'),
          () => selected().flushTelemetry(),
          () => params.hasActiveProvider?.() === true,
          params.isTrustedFolder,
          () => {
            if (params.acquireAgent === undefined)
              throw new Error(
                'Noninteractive execution requires an Agent acquisition operation',
              );
            return params.acquireAgent();
          },
        )
      : captureNonInteractiveRun(
          params.config,
          params.agent,
          params.runtimeSettings !== undefined,
          () => selected().flushTelemetry(),
        );
  await run(
    params.input,
    params.prompt_id,
    params.deferTelemetryShutdown ?? false,
  );
}
const noCliOverrides: ParsedCliArgs = Object.freeze({
  model: undefined,
  sandbox: undefined,
  sandboxImage: undefined,
  sandboxEngine: undefined,
  sandboxProfileLoad: undefined,
  jspBootstrap: undefined,
  jspBootstrapInternalEnvPath: undefined,
  debug: undefined,
  prompt: undefined,
  promptInteractive: undefined,
  outputFormat: undefined,
  quiet: undefined,
  showMemoryUsage: undefined,
  yolo: undefined,
  approvalMode: undefined,
  telemetry: undefined,
  checkpointing: undefined,
  telemetryLogPrompts: undefined,
  telemetryOutfile: undefined,
  allowedMcpServerNames: undefined,
  allowedTools: undefined,
  experimentalAcp: undefined,
  experimentalUi: undefined,
  extensions: undefined,
  listExtensions: undefined,
  provider: undefined,
  key: undefined,
  keyfile: undefined,
  baseurl: undefined,
  proxy: undefined,
  includeDirectories: undefined,
  profileLoad: undefined,
  profile: undefined,
  loadMemoryFromIncludeDirectories: undefined,
  ideMode: undefined,
  screenReader: undefined,
  sessionSummary: undefined,
  dumponerror: undefined,
  promptWords: undefined,
  query: undefined,
  set: undefined,
  continue: undefined,
  nobrowser: undefined,
  listSessions: undefined,
  deleteSession: undefined,
  imageInput: undefined,
  imageOutput: undefined,
  imagePrompt: undefined,
});

export async function buildNonInteractiveActivationIntent(
  config: Config,
): Promise<ProviderActivationIntent> {
  let intent: ProviderActivationIntent | undefined;
  await activateConfiguredProvider(
    config,
    { getActiveProviderName: () => config.getProvider() },
    noCliOverrides,
    {
      preflight: async (assembled) => {
        intent = assembled;
        return { authFailed: false, infoMessages: [] };
      },
    },
  );
  if (intent === undefined)
    throw new Error('Production activation did not publish an intent');
  return intent;
}
