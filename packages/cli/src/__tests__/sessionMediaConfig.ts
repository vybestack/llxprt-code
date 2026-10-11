/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LocalMediaStore } from '@vybestack/llxprt-code-core';
import { join } from 'node:path';

const TEST_MEDIA_LIMIT_BYTES = 1024 * 1024;

type SessionMediaConfig = {
  readonly mediaStore: LocalMediaStore;
  getSessionRecordingQueueByteLimit(): number;
};

export function createTestSessionMediaConfig(
  projectTempDir: string,
): SessionMediaConfig {
  const mediaStore = new LocalMediaStore({
    rootDirectory: join(projectTempDir, 'media'),
    quotaBytes: TEST_MEDIA_LIMIT_BYTES,
  });

  return {
    mediaStore,
    getSessionRecordingQueueByteLimit: () => TEST_MEDIA_LIMIT_BYTES,
  };
}
