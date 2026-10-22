/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { installModelToolFixture } from './model-tool-fixture.js';
import { makeScratchDir } from '../../api/__tests__/helpers/scratch-dir.js';

const root = await makeScratchDir('model-tool-fixture-');
const modelTools = installModelToolFixture({ targetDir: root });
describe('model fixture configured physical tooling', () => {
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it('publishes and executes its actual read declaration rather than an empty model selection', async () => {
    const path = join(root, 'model-tool-fixture-physical.txt');
    await writeFile(path, 'A physical model fixture input.');
    try {
      expect(path).not.toContain(resolve(import.meta.dir, '../../..'));
      const tools = modelTools();
      expect(
        tools.getFunctionDeclarations().map((entry) => entry.name),
      ).toContain('read_file');
      const tool = tools.getTool('read_file');
      if (tool === undefined)
        throw new Error('Missing physical model read capability');
      const result = await tool
        .build({ absolute_path: path })
        .execute(new AbortController().signal);
      expect(result.llmContent).toContain('A physical model fixture input.');
    } finally {
      await rm(path);
    }
  });
});
