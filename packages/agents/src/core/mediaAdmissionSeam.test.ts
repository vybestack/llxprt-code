/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ModelOutput,
  ModelStreamChunk,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  MediaAdmissionService,
  type MediaAdmissionContext,
} from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import {
  admitModelOutputForHistory,
  admitStreamChunkForHistory,
  prepareAdmittedUserTurn,
} from './mediaAdmissionSeam.js';

function createHistory(turnId: string): {
  generateTurnKey: () => string;
  getIdGeneratorCallback: (turnKey?: string) => () => string;
} {
  return {
    generateTurnKey: () => turnId,
    getIdGeneratorCallback: (stableTurnId = 'missing-turn') => {
      let index = 0;
      return () => `id-${stableTurnId}-${index++}`;
    },
  };
}

function createAdmissionRuntime(): {
  readonly mediaAdmission: {
    admitContent(
      content: IContent,
      context: MediaAdmissionContext,
    ): Promise<IContent>;
    admitContents(
      contents: readonly IContent[],
      context: MediaAdmissionContext,
    ): Promise<IContent[]>;
  };
} {
  return {
    mediaAdmission: {
      async admitContent(content: IContent): Promise<IContent> {
        return content;
      },
      async admitContents(
        contents: readonly IContent[],
        context: MediaAdmissionContext,
      ): Promise<IContent[]> {
        return contents.map((content) => ({
          ...content,
          metadata: {
            ...content.metadata,
            providerMetadata: {
              ...content.metadata?.providerMetadata,
              admittedTurnId: context.turnId,
            },
          },
        }));
      },
    },
  };
}

const textHistory: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'assistant turn' }],
};

const emptyBlockHistory: IContent = { speaker: 'ai', blocks: [] };

function chunkWithAfc(afcHistory: IContent[]): ModelStreamChunk {
  return {
    content: { speaker: 'ai', blocks: [{ type: 'text', text: 'streamed' }] },
    afcHistory,
  };
}

function responseWithAfc(afcHistory: IContent[]): ModelOutput {
  return {
    content: { speaker: 'ai', blocks: [{ type: 'text', text: 'completed' }] },
    afcHistory,
  };
}

describe('media admission seam afcHistory normalization', () => {
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';

  it('admits user input under the same minted turn stamped into history', async () => {
    const promptId = 'prompt-1';
    const prepared = await prepareAdmittedUserTurn(
      createAdmissionRuntime(),
      createHistory('turn-minted'),
      [textHistory],
      promptId,
    );
    const persisted = prepared.userContents[0];
    const providerContent = prepared.userIContents[0];

    expect(persisted.metadata?.providerMetadata?.['admittedTurnId']).toBe(
      persisted.metadata?.turnId,
    );
    expect(persisted.metadata?.promptId).toBe(promptId);
    expect(persisted.metadata?.turnId).not.toBe(promptId);
    expect(providerContent.metadata?.id).toContain(prepared.turnId);
  });

  it('keeps streaming afcHistory entries only when they carry blocks', async () => {
    const admitted = await admitStreamChunkForHistory(
      {},
      chunkWithAfc([textHistory, emptyBlockHistory]),
      textHistory,
      'turn-stream',
    );

    expect(admitted.afcHistory).toEqual([textHistory]);
  });

  it('drops streaming afcHistory when every entry has zero blocks', async () => {
    const admitted = await admitStreamChunkForHistory(
      {},
      chunkWithAfc([emptyBlockHistory]),
      emptyBlockHistory,
      'turn-stream-empty',
    );

    expect(admitted.afcHistory).toBeUndefined();
    expect('afcHistory' in admitted).toBe(false);
  });

  it('returns and embeds the same filtered non-streaming afcHistory', async () => {
    const admitted = await admitModelOutputForHistory(
      {},
      responseWithAfc([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'kept' }] },
        emptyBlockHistory,
      ]),
      'turn-out',
    );

    expect(admitted.afcHistory).toEqual([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'kept' }] },
    ]);
    expect(admitted.response.afcHistory).toEqual(admitted.afcHistory);
  });

  it('omits both non-streaming afcHistory representations when every entry is empty', async () => {
    const admitted = await admitModelOutputForHistory(
      {},
      responseWithAfc([emptyBlockHistory]),
      'turn-empty-out',
    );

    expect(admitted.afcHistory).toBeUndefined();
    expect(admitted.response.afcHistory).toBeUndefined();
    expect('afcHistory' in admitted.response).toBe(false);
  });

  it('admits AFC image history through the real media store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'afc-admission-'));
    try {
      const store = new LocalMediaStore({
        rootDirectory: join(directory, 'media'),
        quotaBytes: 1024 * 1024,
      });
      const admission = new MediaAdmissionService(store);
      const admitted = await admitModelOutputForHistory(
        { mediaAdmission: admission },
        responseWithAfc([
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'media',
                mimeType: 'image/png',
                encoding: 'base64',
                data: PNG_BASE64,
              },
            ],
          },
        ]),
        'afc-real-turn',
      );
      const block = admitted.afcHistory?.[0]?.blocks[0];
      if (block?.type !== 'media' || block.encoding !== 'reference') {
        throw new Error('Expected admitted AFC media reference');
      }

      expect(await store.hasReservations(block.contentId)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('propagates real AFC admission rejection without retaining the earlier output admission', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'afc-rejection-'));
    try {
      const store = new LocalMediaStore({
        rootDirectory: join(directory, 'media'),
        quotaBytes: 1024 * 1024,
      });
      const admission = new MediaAdmissionService(store);
      const response: ModelOutput = {
        content: {
          speaker: 'ai',
          blocks: [
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'base64',
              data: PNG_BASE64,
            },
          ],
        },
        afcHistory: [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'media',
                mimeType: 'image/png',
                encoding: 'base64',
                data: 'malformed',
              },
            ],
          },
        ],
      };

      await expect(
        admitModelOutputForHistory(
          { mediaAdmission: admission },
          response,
          'afc-rejection-turn',
        ),
      ).rejects.toThrow(/media admission failed/i);

      const admittedOutput = await admission.admitContent(response.content, {
        turnId: 'afc-rejection-probe',
        source: 'probe',
      });
      const block = admittedOutput.blocks[0];
      if (block.type !== 'media' || block.encoding !== 'reference') {
        throw new Error('Expected output media reference');
      }
      await admission.releaseAdmissions([
        {
          contents: [admittedOutput],
          context: { turnId: 'afc-rejection-probe', source: 'probe' },
          mode: 'content',
        },
      ]);
      expect(await store.hasReservations(block.contentId)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
