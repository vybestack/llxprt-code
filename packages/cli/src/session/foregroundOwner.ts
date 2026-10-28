/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentProfilePreflight } from '@vybestack/llxprt-code-agents';
import type { ForegroundAdmission } from '../cliAgentBootstrap.js';
import type { SessionSettingsOperations } from '../runtime/createRuntimeOwnerFeatures.js';

export interface ForegroundOwnerOperations {
  readonly admission: ForegroundAdmission;
  readonly runtimeSettings: SessionSettingsOperations;
  flushTelemetry(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Projects the preflight onto the operations the foreground session owner
 * calls, so the session host and the terminal session never receive the
 * preflight itself.
 */
export function createForegroundOwner(
  preflight: AgentProfilePreflight,
): ForegroundOwnerOperations {
  return {
    admission: {
      admitForegroundAgent: (token, intent, host) =>
        preflight.admitForegroundAgent(token, intent, host),
    },
    runtimeSettings: {
      logUserPrompt: (config, event) => preflight.logUserPrompt(config, event),
      logSlashCommand: (config, event) =>
        preflight.logSlashCommand(config, event),
      isTelemetryEnabled: () => preflight.isTelemetryEnabled(),
      flushTelemetry: () => preflight.flushTelemetry(),
      readNamedParameter: (key) => preflight.readNamedParameter(key),
      readDefaultProfileName: () => preflight.readDefaultProfileName(),
      readTelemetrySettings: () => preflight.readTelemetrySettings(),
      updateTelemetrySettings: (settings) =>
        preflight.updateTelemetrySettings(settings),
      readConversationLoggingEnabled: () =>
        preflight.readConversationLoggingEnabled(),
      subscribeModelChanges: (listener) =>
        preflight.subscribeModelChanges(listener),
    },
    flushTelemetry: () => preflight.flushTelemetry(),
    dispose: () => preflight.dispose(),
  };
}
