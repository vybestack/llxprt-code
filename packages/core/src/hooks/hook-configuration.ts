import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceTrustControlPort } from '../services/workspace-trust-ports.js';
import type { Config } from '../config/config.js';
import type { EnvironmentSanitizationConfig } from '../services/environmentSanitization.js';
import type { HookDefinition, HookEventName } from './types.js';
import type { HookCallEvent } from '../telemetry/types.js';
import { logHookCall } from '../telemetry/loggers.js';

export interface HookDefinitionConfiguration {
  readonly hooks: { [K in HookEventName]?: HookDefinition[] } | undefined;
  readonly projectHooks:
    | { [K in HookEventName]?: HookDefinition[] }
    | undefined;
  readonly disabledHooks: readonly string[];
  readonly extensions: ReadonlyArray<{
    readonly isActive: boolean;
    readonly hooks?: { [K in HookEventName]?: HookDefinition[] };
  }>;
}

export interface HookProcessConfiguration {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly sanitization: EnvironmentSanitizationConfig;
}

export interface HookSessionRuntime {
  readonly cwd: string;
  readonly sessionId: () => string;
  readonly transcriptPath: () => string | undefined;
  readonly isTrustedFolder: () => boolean;
  readonly onTrustPolicyChanged: (
    listener: (trusted: boolean) => void,
  ) => () => void;
  readonly onTrustTransition: (
    listener: (trusted: boolean) => Promise<void>,
  ) => () => void;
  readonly process: HookProcessConfiguration;
  readonly logCall: (event: HookCallEvent) => void;
}

export function readHookDefinitions(
  config: Pick<
    Config,
    'getHooks' | 'getProjectHooks' | 'getDisabledHooks' | 'getExtensions'
  >,
): () => HookDefinitionConfiguration {
  return () => ({
    hooks: config.getHooks(),
    projectHooks: config.getProjectHooks(),
    disabledHooks: config.getDisabledHooks(),
    extensions: config.getExtensions(),
  });
}

export function hookSessionRuntime(
  config: Pick<
    Config,
    'getTargetDir' | 'getSessionId' | 'getSanitizationConfig'
  >,
  trust: WorkspaceTrustControlPort,
  telemetry: RootTelemetry,
): HookSessionRuntime {
  return {
    cwd: config.getTargetDir(),
    sessionId: () => config.getSessionId(),
    transcriptPath: () => undefined,
    isTrustedFolder: () => trust.isTrustedFolder(),
    onTrustPolicyChanged: (listener) =>
      trust.subscribeTrustChange((transition) => listener(transition.trusted)),
    onTrustTransition: (listener) =>
      trust.subscribeTrustTransition((transition) =>
        listener(transition.trusted),
      ),
    process: {
      environment: { ...process.env },
      sanitization: config.getSanitizationConfig() ?? {
        enableEnvironmentVariableRedaction: false,
        allowedEnvironmentVariables: [],
        blockedEnvironmentVariables: [],
      },
    },
    logCall: (event) => logHookCall(config, event, telemetry),
  };
}
