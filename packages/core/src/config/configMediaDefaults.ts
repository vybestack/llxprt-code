/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export abstract class ConfigMediaDefaults {
  getSessionRecordingQueueByteLimit(): number {
    return 16 * 1024 * 1024;
  }

  getSessionPersistenceQueueByteLimit(): number {
    return 16 * 1024 * 1024;
  }

  getMediaStoreQuotaByteLimit(): number {
    return 4 * 1024 * 1024 * 1024;
  }
}
