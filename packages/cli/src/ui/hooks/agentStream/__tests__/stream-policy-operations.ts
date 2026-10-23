/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { StreamRuntime } from '../../../cliUiRuntime.js';

export function streamPolicyOperations(runtime: StreamRuntime) {
  return {
    atCommandConfig: runtime.files,
    readSessionId: () => runtime.session.getSessionId(),
    subscribeMcpUpdates: (listener: () => void) =>
      runtime.events.onMcpClientUpdate(listener),
    resetBuckets: () => runtime.bucketFailover.resetBuckets?.(),
    resetBucketSession: () => runtime.bucketFailover.resetBucketSession?.(),
    ensureBucketsAuthenticated: async () => {
      await runtime.bucketFailover.ensureBucketsAuthenticated?.();
    },
    logUserPrompt: (
      event: Parameters<StreamRuntime['settings']['logUserPrompt']>[0],
    ) => runtime.settings.logUserPrompt(event),
    getModel: () => runtime.model.getModel(),
    getProvider: () => runtime.model.getProvider(),
    readSelectedProvider: () => runtime.settings.readSelectedProvider(),
    readCitations: () => runtime.settings.readCitations(),
    readProfileName: () => runtime.settings.readProfileName(),
    readContextLimit: () =>
      runtime.ephemeral.getEphemeralSetting('context-limit'),
    getMaxSessionTurns: () => runtime.sessionLimits.getMaxSessionTurns(),
  };
}
