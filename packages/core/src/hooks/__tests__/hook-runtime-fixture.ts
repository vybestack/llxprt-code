/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '../../config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '../../session/session-settings-owner.js';
import type { WorkspaceTrustLifecycle } from '../../services/workspace-trust-lifecycle.js';
import { HookSystem } from '../hookSystem.js';
import {
  hookSessionRuntime,
  readHookDefinitions,
  type HookDefinitionConfiguration,
  type HookSessionRuntime,
} from '../hook-configuration.js';

export function createOwnedHookRoot(
  config: Config,
  trust: WorkspaceTrustLifecycle,
): { root: HookSystem; settingsOwner: SessionSettingsOwner } {
  const settingsOwner = new SessionSettingsOwner(new SettingsService());
  settingsOwner.bindTelemetry(config);
  return {
    root: new HookSystem(
      readHookDefinitions(config),
      hookSessionRuntime(config, trust, settingsOwner.telemetry),
    ),
    settingsOwner,
  };
}

export function fixtureHookRuntime(
  config: Partial<
    Pick<Config, 'getTargetDir' | 'getSessionId' | 'getSanitizationConfig'>
  > &
    Partial<
      Pick<
        HookSessionRuntime,
        'isTrustedFolder' | 'onTrustPolicyChanged' | 'onTrustTransition'
      >
    >,
): HookSessionRuntime {
  return {
    cwd: config.getTargetDir?.() ?? process.cwd(),
    sessionId: () => config.getSessionId?.() ?? 'hook-fixture',
    transcriptPath: () => undefined,
    isTrustedFolder: () => config.isTrustedFolder?.() ?? true,
    onTrustPolicyChanged: (listener) =>
      config.onTrustPolicyChanged?.(listener) ?? (() => {}),
    onTrustTransition: (listener) =>
      config.onTrustTransition?.(listener) ?? (() => {}),
    process: {
      environment: { ...process.env },
      sanitization: config.getSanitizationConfig?.() ?? {
        enableEnvironmentVariableRedaction: false,
        allowedEnvironmentVariables: [],
        blockedEnvironmentVariables: [],
      },
    },
    logCall: () => {},
  };
}

export function fixtureHookDefinitions(
  config: Partial<
    Pick<
      Config,
      'getHooks' | 'getProjectHooks' | 'getDisabledHooks' | 'getExtensions'
    >
  >,
): () => HookDefinitionConfiguration {
  return () => ({
    hooks: config.getHooks?.(),
    projectHooks: config.getProjectHooks?.(),
    disabledHooks: config.getDisabledHooks?.() ?? [],
    extensions: config.getExtensions?.() ?? [],
  });
}
