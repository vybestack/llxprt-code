/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';

export type RuntimeProfileAgent = Pick<
  Agent,
  | 'getRuntimeId'
  | 'getProvider'
  | 'setProvider'
  | 'getActiveProfileName'
  | 'setDefaultProfileName'
  | 'getRuntimeDiagnosticsSnapshot'
  | 'saveProfileSnapshot'
  | 'deleteProfileByName'
> & {
  readonly auth: Pick<Agent['auth'], 'setBaseUrl'>;
  readonly profiles: Pick<Agent['profiles'], 'load'>;
};

export function projectRuntimeAgent(
  agent: RuntimeProfileAgent,
): RuntimeProfileAgent {
  return {
    getRuntimeId: () => agent.getRuntimeId(),
    getProvider: () => agent.getProvider(),
    setProvider: (provider, model, options) =>
      agent.setProvider(provider, model, options),
    getActiveProfileName: () => agent.getActiveProfileName(),
    setDefaultProfileName: (name) => agent.setDefaultProfileName(name),
    getRuntimeDiagnosticsSnapshot: () => agent.getRuntimeDiagnosticsSnapshot(),
    saveProfileSnapshot: (name, additional) =>
      agent.saveProfileSnapshot(name, additional),
    deleteProfileByName: (name) => agent.deleteProfileByName(name),
    auth: { setBaseUrl: (url, options) => agent.auth.setBaseUrl(url, options) },
    profiles: { load: (name) => agent.profiles.load(name) },
  };
}
