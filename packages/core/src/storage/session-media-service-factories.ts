/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Storage } from '@vybestack/llxprt-code-settings';
import { join } from 'node:path';
import { LocalMediaStore } from './local-media-store.js';
import { SessionPersistenceService } from './SessionPersistenceService.js';

interface SessionMediaServiceHost {
  readonly storage: Storage;
  getMediaStoreQuotaByteLimit(): number;
  getSessionPersistenceQueueByteLimit(): number;
}

interface SessionMediaServices {
  readonly store: () => LocalMediaStore;
  readonly persistence: (sessionId: string) => SessionPersistenceService;
}

export function sessionMediaServices(
  host: SessionMediaServiceHost,
): SessionMediaServices {
  let mediaStore: LocalMediaStore | undefined;
  const persistenceServices = new Map<string, SessionPersistenceService>();
  const store = (): LocalMediaStore => {
    mediaStore ??= new LocalMediaStore({
      rootDirectory: join(host.storage.getProjectTempDir(), 'media'),
      quotaBytes: host.getMediaStoreQuotaByteLimit(),
    });
    return mediaStore;
  };
  return {
    store,
    persistence: (sessionId) => {
      const existing = persistenceServices.get(sessionId);
      if (existing !== undefined) return existing;
      const service = new SessionPersistenceService(host.storage, sessionId, {
        mediaStore: store(),
        maxQueueBytes: host.getSessionPersistenceQueueByteLimit(),
      });
      persistenceServices.set(sessionId, service);
      return service;
    },
  };
}
