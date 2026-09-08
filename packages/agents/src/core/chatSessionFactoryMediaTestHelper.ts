/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';

export interface ChatSessionFactoryMediaFixture {
  readonly store: LocalMediaStore;
  readonly history: IContent[];
  readonly hasReservationsAfterProbe: () => Promise<boolean>;
}

export async function withChatSessionFactoryMediaFixture(
  run: (fixture: ChatSessionFactoryMediaFixture) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'chat-session-factory-'));
  const store = new LocalMediaStore({
    rootDirectory: join(directory, 'media'),
    quotaBytes: 1024 * 1024,
  });
  const history: IContent[] = [
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
        },
      ],
    },
  ];
  try {
    await run({
      store,
      history,
      hasReservationsAfterProbe: async () => {
        const admission = new MediaAdmissionService(store);
        const context = { turnId: 'probe', source: 'probe' };
        const probe = await admission.admitContents(history, context);
        const block = probe[0].blocks[0];
        if (block.type !== 'media' || block.encoding !== 'reference') {
          throw new Error('Expected probe media reference');
        }
        await admission.releaseContents(probe, context);
        return store.hasReservations(block.contentId);
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
