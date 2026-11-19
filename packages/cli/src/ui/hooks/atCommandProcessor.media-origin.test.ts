/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { handleAtCommand } from './atCommandProcessor.js';
import {
  setupAtCommandTest,
  teardownAtCommandTest,
  unexpectedResourceRead,
  type AtCommandTestSetup,
} from './__tests__/atCommandProcessor-test-helpers.js';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64',
);

describe('@file images carry where they were read from', () => {
  let setup: AtCommandTestSetup;

  beforeEach(async () => {
    setup = await setupAtCommandTest();
  });

  afterEach(async () => {
    await teardownAtCommandTest(setup);
  });

  async function mediaFor(relativePath: string): Promise<unknown[]> {
    const fullPath = path.join(setup.testRootDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, PNG_BYTES);
    const result = await handleAtCommand({
      readResource: unexpectedResourceRead,
      findResource: () => undefined,
      query: `look at @${relativePath}`,
      config: setup.mockConfig,
      addItem: setup.mockAddItem,
      onDebugMessage: setup.mockOnDebugMessage,
      messageId: 501,
      signal: setup.abortController.signal,
      getToolHandle: setup.getToolHandle,
    });
    const blocks = Array.isArray(result.processedQuery)
      ? result.processedQuery
      : [];
    return blocks.filter((block) => 'type' in block && block.type === 'media');
  }

  it('sends the image as media with a file origin holding the absolute path', async () => {
    const media = await mediaFor('shots/screen.png');
    const absolutePath = await fs.realpath(
      path.join(setup.testRootDir, 'shots/screen.png'),
    );
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({
      mimeType: 'image/png',
      encoding: 'base64',
      origin: { kind: 'file', path: absolutePath },
    });
  });

  it('records an image saved from the clipboard as pasted', async () => {
    const media = await mediaFor('.llxprt-clipboard/clipboard-1700000000.png');
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ origin: { kind: 'pasted' } });
    expect(media[0]).not.toHaveProperty('origin.path');
  });
});
