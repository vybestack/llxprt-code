/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PLACEHOLDER_MODEL, type Config } from '@vybestack/llxprt-code-core';
import type {
  Agent,
  ProviderActivationIntent,
} from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from '../config/settings.js';
import type { BootstrapProfileArgs } from '../config/profileBootstrap.js';
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
type ConfigWithBootstrapArgs = Config & {
  readonly _bootstrapArgs?: BootstrapProfileArgs;
  readonly _profileModelParams?: Record<string, unknown>;
  readonly _cliModelParams?: Record<string, unknown>;
};

function readBootstrapArgs(
  config: ConfigWithBootstrapArgs,
): BootstrapProfileArgs | undefined {
  return config._bootstrapArgs;
}

function buildActivationCliOverrides(
  bootstrapArgs: BootstrapProfileArgs | undefined,
): ProviderActivationIntent['cliOverrides'] | undefined {
  if (bootstrapArgs === undefined) {
    return undefined;
  }
  const overrides = {
    ...(bootstrapArgs.keyOverride !== null
      ? { key: bootstrapArgs.keyOverride }
      : {}),
    ...(bootstrapArgs.keyfileOverride !== null
      ? { keyfile: bootstrapArgs.keyfileOverride }
      : {}),
    ...(bootstrapArgs.keyNameOverride !== null
      ? { keyName: bootstrapArgs.keyNameOverride }
      : {}),
    ...(bootstrapArgs.baseurlOverride !== null
      ? { baseUrl: bootstrapArgs.baseurlOverride }
      : {}),
    ...(bootstrapArgs.setOverrides !== null
      ? { set: bootstrapArgs.setOverrides }
      : {}),
  };
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function collectActivationModelParams(
  profileParams: Record<string, unknown> | undefined,
  cliParams: Record<string, unknown> | undefined,
): ProviderActivationIntent['modelParams'] | undefined {
  const mergedModelParams: Record<string, unknown> = {};

  // Profile model params apply regardless of provider source. A CLI provider
  // override suppresses the profile's provider/model selection, not its model
  // params (see profileResolution.ts contract).
  if (profileParams) {
    Object.assign(mergedModelParams, profileParams);
  }
  if (cliParams) {
    Object.assign(mergedModelParams, cliParams);
  }

  return Object.keys(mergedModelParams).length > 0
    ? mergedModelParams
    : undefined;
}

function buildActivationIntent(
  useExternalAuth: boolean,
  bootstrapArgs: BootstrapProfileArgs | undefined,
  modelParams: ProviderActivationIntent['modelParams'],
  configModel: string,
  selectedProvider: string | undefined,
  readDefaultProvider: () => string | undefined,
): ProviderActivationIntent {
  const cliOverrides = buildActivationCliOverrides(bootstrapArgs);
  const resolvedModel =
    bootstrapArgs?.modelOverride ??
    (configModel !== PLACEHOLDER_MODEL ? configModel : undefined);
  const configProvider =
    selectedProvider ?? bootstrapArgs?.providerOverride ?? undefined;
  const activeProvider =
    configProvider === undefined ? readDefaultProvider() : undefined;
  return {
    ...(configProvider !== undefined ? { provider: configProvider } : {}),
    ...(activeProvider !== undefined
      ? { defaultProvider: activeProvider }
      : {}),
    authMode: useExternalAuth ? 'none' : 'auto',
    ...(typeof resolvedModel === 'string' && resolvedModel.trim().length > 0
      ? { model: resolvedModel.trim() }
      : {}),
    ...(modelParams !== undefined ? { modelParams } : {}),
    ...(cliOverrides !== undefined ? { cliOverrides } : {}),
  };
}

export function buildNonInteractiveActivationIntent(
  config: ConfigWithBootstrapArgs,
  settings: LoadedSettings,
): ProviderActivationIntent {
  return buildActivationIntent(
    settings.merged.useExternalAuth === true,
    readBootstrapArgs(config),
    collectActivationModelParams(
      config._profileModelParams,
      config._cliModelParams,
    ),
    config.getModel(),
    config.getProvider(),
    () => config.getProvider(),
  );
}
