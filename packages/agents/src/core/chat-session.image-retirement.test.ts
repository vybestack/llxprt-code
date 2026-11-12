/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3984: a long conversation of small images, each far below any token
 * threshold, through the real ChatSession request producer, enforcer and media
 * resolver. Bytes selected per request stay within the image budget while the
 * canonical history keeps every image and the newest image always arrives.
 */

import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMediaHistoryChat } from './__tests__/selected-chat-media-fixture.js';

const BUDGET = 1024 * 1024;
const IMAGE_CHARACTERS = 100_000;
const IMAGE_COUNT = 30;

interface RequestObservation {
  readonly imageBytes: number;
  readonly notes: number;
  readonly imageData: readonly string[];
}

function observe(contents: readonly IContent[]): RequestObservation {
  const imageData: string[] = [];
  let notes = 0;
  for (const content of contents) {
    for (const block of content.blocks) {
      if (block.type === 'media' && block.encoding === 'base64') {
        imageData.push(block.data);
      }
      if (
        block.type === 'text' &&
        block.text.includes('was omitted from this request')
      ) {
        notes += 1;
      }
    }
  }
  return {
    imageBytes: imageData.reduce((sum, data) => sum + data.length, 0),
    notes,
    imageData,
  };
}

function imageFor(index: number): IContent {
  const data = String.fromCharCode(65 + (index % 26)).repeat(IMAGE_CHARACTERS);
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: `screenshot ${index}` },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data,
        semanticMetadata: {},
      },
    ],
  };
}

describe('ChatSession historical image retirement (issue #3984)', () => {
  const owners: SessionSettingsOwner[] = [];
  let directory = '';
  let lifecycle: ProviderFileLifecycle;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-chat-retire-'));
    lifecycle = new ProviderFileLifecycle({ maxFiles: 100, maxBytes: 1 << 29 });
  });
  afterEach(async () => {
    for (const owner of owners.splice(0)) await owner.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it('bounds the bytes selected per request across a long image conversation', async () => {
    const observations: RequestObservation[] = [];
    const chat = createMediaHistoryChat(
      directory,
      lifecycle,
      owners,
      async (_request, _bindings, contents) => {
        observations.push(observe(contents));
      },
      { quotaBytes: 64 * 1024 * 1024, mediaBudgetBytes: BUDGET },
    );
    const history = chat.getHistoryService();

    for (let index = 0; index < IMAGE_COUNT; index += 1) {
      history.add(imageFor(index));
      history.add({ speaker: 'ai', blocks: [{ type: 'text', text: 'seen' }] });
      await chat.sendMessage(
        { message: `continue ${index}` },
        `retire-${index}`,
      );
    }

    const retiredPerRequest = observations.map((entry) => entry.notes);
    const retirementEvents = retiredPerRequest.filter(
      (count, index) => count !== (retiredPerRequest[index - 1] ?? 0),
    ).length;
    if (observations.length === 0) throw new Error('No request was observed');
    const latest = observations[observations.length - 1];
    expect({
      requests: observations.length,
      everyRequestWithinBudget: observations.every(
        (entry) => entry.imageBytes <= BUDGET,
      ),
      retirementNeverShrinks: retiredPerRequest.every(
        (count, index) => count >= (retiredPerRequest[index - 1] ?? 0),
      ),
      retiresInBatchesNotEveryRequest:
        retirementEvents > 0 && retirementEvents <= IMAGE_COUNT / 3,
      latestImageArrived:
        latest.imageData[latest.imageData.length - 1] ===
        imageFor(IMAGE_COUNT - 1).blocks.flatMap((block) =>
          block.type === 'media' && block.encoding === 'base64'
            ? [block.data]
            : [],
        )[0],
      canonicalImages: history
        .getAll()
        .flatMap((content) => content.blocks)
        .filter((block) => block.type === 'media').length,
    }).toStrictEqual({
      requests: IMAGE_COUNT,
      everyRequestWithinBudget: true,
      retirementNeverShrinks: true,
      retiresInBatchesNotEveryRequest: true,
      latestImageArrived: true,
      canonicalImages: IMAGE_COUNT,
    });
  });
});
