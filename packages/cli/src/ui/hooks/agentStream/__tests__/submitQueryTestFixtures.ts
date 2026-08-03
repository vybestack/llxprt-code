/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LoadedSettings } from '../../../../config/settings.js';
import type { QueuedSubmission } from '../types.js';

export function createQueueOperations(ref: { current: QueuedSubmission[] }) {
  return {
    enqueueSubmission: (submission: QueuedSubmission) => {
      ref.current = [...ref.current, submission];
    },
    requeueSubmission: (submission: QueuedSubmission) => {
      ref.current = [submission, ...ref.current];
    },
    dequeueSubmission: (): QueuedSubmission | undefined => {
      const [first, ...rest] = ref.current;
      ref.current = rest;
      return first;
    },
    clearSubmissions: () => void (ref.current = []),
  };
}

export function createMockOverrides() {
  return {
    session: { getSessionId: () => 'test-session' },
    model: {
      getModel: () => 'test-model',
      getContentGeneratorConfig: () => ({ model: 'test-model' }),
    },
    mcp: {
      getMcpClientManager: () => undefined,
      getMcpServers: () => ({}),
    },
    asyncTasks: {
      setupAsyncTaskAutoTrigger: () => () => {},
    },
  };
}

export function createLoadedSettings(): LoadedSettings {
  return new LoadedSettings(
    { path: '/system/settings.json', settings: {} },
    { path: '/system/defaults.json', settings: {} },
    { path: '/user/settings.json', settings: {} },
    { path: '/workspace/settings.json', settings: {} },
    true,
  );
}
