/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createInitCommand } from './initCommand.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';

describe('initCommand', () => {
  let mockContext: CommandOwnerFixture;
  let targetDir: string;
  let llxprtMdPath: string;

  beforeEach(() => {
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-init-'));
    llxprtMdPath = path.join(targetDir, 'LLXPRT.md');
    mockContext = createMockCommandContext({
      services: {
        config: {
          getTargetDir: () => targetDir,
        },
      },
    });
  });

  afterEach(() => {
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  const runInit = (): ReturnType<
    NonNullable<ReturnType<typeof createInitCommand>['action']>
  > =>
    createInitCommand(
      mockContext.services.config?.getTargetDir(),
      mockContext.ui.addItem,
    ).action!(mockContext, '');

  it('should inform the user if LLXPRT.md already exists', async () => {
    fs.writeFileSync(llxprtMdPath, 'my notes');

    const result = await runInit();

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content:
        'A LLXPRT.md file already exists in this directory. No changes were made.',
    });
    expect(fs.readFileSync(llxprtMdPath, 'utf8')).toBe('my notes');
  });

  it('should create LLXPRT.md and submit a prompt if it does not exist', async () => {
    const result = await runInit();

    expect(fs.readFileSync(llxprtMdPath, 'utf8')).toBe('');
    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: 'info',
        text: 'Empty LLXPRT.md created. Now analyzing the project to populate it.',
      },
      expect.any(Number),
    );
    if (result?.type !== 'submit_prompt')
      throw new Error('Expected submitted prompt');
    expect(result.content).toContain(
      'You are an AI agent that brings the power of multiple LLM providers',
    );
  });

  it.skipIf(process.platform === 'win32')(
    'should not create a file through a dangling LLXPRT.md symlink',
    async () => {
      const elsewhere = path.join(targetDir, 'elsewhere.txt');
      fs.symlinkSync(elsewhere, llxprtMdPath);

      const result = await runInit();

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content:
          'A LLXPRT.md file already exists in this directory. No changes were made.',
      });
      expect(fs.existsSync(elsewhere)).toBe(false);
    },
  );

  it('should return an error if config is not available', async () => {
    const noConfigContext = createMockCommandContext();
    noConfigContext.services.config = null;

    const result = await createInitCommand(
      noConfigContext.services.config?.getTargetDir(),
      noConfigContext.ui.addItem,
    ).action!(noConfigContext, '');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content: 'Configuration not available.',
    });
  });
});
