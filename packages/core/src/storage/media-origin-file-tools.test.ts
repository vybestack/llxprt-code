/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ReadFileTool,
  ReadManyFilesTool,
  type IToolHost,
} from '@vybestack/llxprt-code-tools';
import { convertToFunctionResponse } from '../utils/generateContentResponseUtilities.js';
import { isMediaReferenceBlock } from '../services/history/IContent.js';
import { LocalMediaStore } from './local-media-store.js';
import { MediaAdmissionService } from './media-admission-service.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';

function hostFor(targetDir: string): IToolHost {
  return {
    readTextFile: (filePath) => readFile(filePath, 'utf8'),
    writeTextFile: (filePath, content) => writeFile(filePath, content, 'utf8'),
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,
    runSearch: (_directories, operation) => operation(),
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getLlxprtIgnorePatterns: () => [],
    readExecutionPolicy: () => ({}),
    getDebugMode: () => false,
  };
}

describe('file tools record where an image was read from', () => {
  let directory = '';
  let imagePath = '';
  let admission: MediaAdmissionService;

  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'media-origin-tools-')),
    );
    await mkdir(join(directory, 'shots'));
    imagePath = join(directory, 'shots', 'screen.png');
    await writeFile(imagePath, Buffer.from(PNG_BASE64, 'base64'));
    admission = new MediaAdmissionService(
      new LocalMediaStore({
        rootDirectory: join(directory, 'media'),
        quotaBytes: 1024 * 1024,
      }),
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function admittedOrigin(
    toolName: string,
    llmContent: unknown,
  ): Promise<unknown> {
    const blocks = convertToFunctionResponse(toolName, 'call-1', llmContent);
    const admitted = await admission.admitContent(
      { speaker: 'tool', blocks, metadata: { turnId: 'turn-tools' } },
      { turnId: 'turn-tools', source: 'test' },
    );
    const media = admitted.blocks.find((block) => block.type === 'media');
    expect(isMediaReferenceBlock(media)).toBe(true);
    return media?.origin;
  }

  it('read_file stamps a file origin with the absolute path', async () => {
    const result = await new ReadFileTool(hostFor(directory))
      .build({ absolute_path: imagePath })
      .execute(new AbortController().signal);
    expect(await admittedOrigin('read_file', result.llmContent)).toMatchObject({
      kind: 'file',
      path: imagePath,
    });
  });

  it('read_many_files stamps a file origin with the absolute path', async () => {
    const result = await new ReadManyFilesTool(hostFor(directory))
      .build({ paths: ['shots/screen.png'] })
      .execute(new AbortController().signal);
    expect(
      await admittedOrigin('read_many_files', result.llmContent),
    ).toMatchObject({ kind: 'file', path: imagePath });
  });
});
