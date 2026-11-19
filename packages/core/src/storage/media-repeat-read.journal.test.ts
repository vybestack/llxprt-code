/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertNotNull } from '@vybestack/llxprt-code-test-utils';
import { StandardFileSystemService } from '@vybestack/llxprt-code-storage';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withTestNamedWriters } from '../journal/__tests__/support/namedWriterOwner.js';
import type { IContent } from '../services/history/IContent.js';
import { JournalRecordingService } from '../recording/journalRecordingService.js';
import { processSingleFileContent } from '../utils/fileUtils.js';
import { LocalMediaStore } from './local-media-store.js';
import { MediaAdmissionService } from './media-admission-service.js';

const READS = 900;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IMAGE_BYTES = 64 * 1024;

function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(IMAGE_BYTES);
  bytes.set(PNG_SIGNATURE, 0);
  for (let index = PNG_SIGNATURE.length; index < bytes.length; index++) {
    bytes[index] = (index * 131 + 17) % 251;
  }
  return bytes;
}

async function directoryBytes(directory: string): Promise<{
  readonly files: number;
  readonly bytes: number;
}> {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await directoryBytes(path);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += (await stat(path)).size;
    }
  }
  return { files, bytes };
}

async function toolRowFromRead(
  imagePath: string,
  root: string,
  read: number,
): Promise<IContent> {
  const result = await processSingleFileContent(
    imagePath,
    root,
    new StandardFileSystemService(),
  );
  const content = result.llmContent;
  if (typeof content === 'string' || !('inlineData' in content)) {
    throw new Error(`read_file did not return image media: ${result.error}`);
  }
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: `call-${read}`,
        toolName: 'read_file',
        result: { output: `Read image ${imagePath}` },
      },
      {
        type: 'media',
        mimeType: content.inlineData.mimeType,
        encoding: 'base64',
        data: content.inlineData.data,
      },
    ],
    metadata: { turnId: `turn-${read}` },
  };
}

describe('repeated reads of one image', () => {
  let directory = '';
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-media-repeat-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function recordReads(
    name: string,
    rowFor: (read: number) => Promise<IContent>,
  ): Promise<string> {
    const recording = JournalRecordingService.create(
      withTestNamedWriters({
        sessionId: `session-${name}`,
        projectHash: 'project-hash',
        chatsDir: join(directory, `chats-${name}`),
        workspaceDirs: [directory],
        provider: 'test',
        model: 'test',
      }),
    );
    try {
      const session = await recording.session();
      for (let read = 0; read < READS; read++) {
        await session.append([await rowFor(read)]);
      }
      await recording.flush();
      const filePath = recording.getFilePath();
      assertNotNull(filePath, 'Expected materialized recording');
      return filePath;
    } finally {
      await recording.dispose();
    }
  }

  it('stores one blob for 900 reads and journals only references', async () => {
    const image = pngBytes();
    const imagePath = join(directory, 'diagram.png');
    await writeFile(imagePath, image);
    const digest = createHash('sha256').update(image).digest('hex');
    const mediaRoot = join(directory, 'media');
    const store = new LocalMediaStore({
      rootDirectory: mediaRoot,
      quotaBytes: IMAGE_BYTES * 4,
    });
    const admission = new MediaAdmissionService(store);
    try {
      const withMedia = await recordReads('media', async (read) => {
        const row = await admission.admitContent(
          await toolRowFromRead(imagePath, directory, read),
          { turnId: `turn-${read}`, source: 'tool-result' },
        );
        const media = row.blocks[1];
        if (media.type !== 'media' || media.encoding !== 'reference') {
          throw new Error('Admission did not turn the image into a reference');
        }
        expect(media.contentId).toBe(`sha256:${digest}`);
        return row;
      });
      const control = await recordReads('control', async (read) => {
        const row = await toolRowFromRead(imagePath, directory, read);
        return { ...row, blocks: row.blocks.slice(0, 1) };
      });

      const objects = await directoryBytes(join(mediaRoot, 'objects'));
      expect(objects).toStrictEqual({ files: 1, bytes: IMAGE_BYTES });
      const journal = await readFile(withMedia);
      const base64 = Buffer.from(image).toString('base64');
      expect(journal.indexOf(base64.slice(4096, 4160))).toBe(-1);
      const controlBytes = (await stat(control)).size;
      // A reference costs a few hundred bytes per row over the same rows
      // without media; one inline copy per row would add about 79 MB.
      expect(journal.byteLength - controlBytes).toBeLessThan(READS * 1024);
    } finally {
      await store.close();
    }
  }, 120_000);
});
