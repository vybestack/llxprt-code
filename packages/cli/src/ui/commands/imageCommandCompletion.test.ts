/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  analyzeImageCompletion,
  completeImageCommand,
} from './imageCommandCompletion.js';

describe('analyzeImageCompletion', () => {
  it('returns output phase for empty input', () => {
    const state = analyzeImageCompletion('');
    expect(state.phase).toBe('output');
  });

  it('returns output phase when typing the first token', () => {
    const state = analyzeImageCompletion('cat');
    expect(state.phase).toBe('output');
    expect(state.partial).toBe('cat');
  });

  it('returns input phase after output path with trailing space', () => {
    const state = analyzeImageCompletion('out.png ');
    expect(state.phase).toBe('input');
  });

  it('returns input phase when typing an input path', () => {
    const state = analyzeImageCompletion('out.png in');
    expect(state.phase).toBe('input');
    expect(state.partial).toBe('in');
  });

  it('returns prompt phase when a quoted prompt begins', () => {
    const state = analyzeImageCompletion('out.png "draw');
    expect(state.phase).toBe('prompt');
  });

  it('returns none/prompt phase after five inputs', () => {
    const state = analyzeImageCompletion(
      'out.png a.png b.png c.png d.png e.png ',
    );
    expect(['none', 'prompt']).toContain(state.phase);
  });
});

describe('completeImageCommand (real workspace filesystem)', () => {
  let workspaceRoot = '';

  beforeEach(async () => {
    workspaceRoot = await fs.promises.realpath(
      await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'llxprt-image-completion-'),
      ),
    );
    await fs.promises.writeFile(
      path.join(workspaceRoot, 'cat.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    await fs.promises.writeFile(
      path.join(workspaceRoot, 'dog.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    await fs.promises.writeFile(path.join(workspaceRoot, 'notes.txt'), 'hi');
    await fs.promises.mkdir(path.join(workspaceRoot, 'subdir'));
  });

  afterEach(async () => {
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('suggests workspace directories in the output phase', async () => {
    const suggestions = await completeImageCommand('', workspaceRoot);
    expect(suggestions.some((s) => s.includes('subdir'))).toBe(true);
  });

  it('allows a new .png filename in the output phase', async () => {
    const suggestions = await completeImageCommand('', workspaceRoot);
    expect(suggestions.some((s) => s.endsWith('.png'))).toBe(true);
  });

  it('suggests existing input images after the output path', async () => {
    const suggestions = await completeImageCommand('out.png ', workspaceRoot);
    expect(suggestions.some((s) => s.includes('cat.png'))).toBe(true);
    expect(suggestions.some((s) => s.includes('dog.png'))).toBe(true);
    expect(suggestions.some((s) => s.includes('notes.txt'))).toBe(false);
  });

  it('suggests a quoted prompt hint alongside input images after the output path', async () => {
    const suggestions = await completeImageCommand('out.png ', workspaceRoot);
    // BOTH continuations must be discoverable: filesystem inputs AND a prompt.
    expect(suggestions.some((s) => s.includes('cat.png'))).toBe(true);
    const promptHint = suggestions.find((s) => s.startsWith('"'));
    expect(promptHint).toBeDefined();
  });

  it('suggests directories as input paths', async () => {
    const suggestions = await completeImageCommand('out.png ', workspaceRoot);
    expect(suggestions.some((s) => s.includes('subdir'))).toBe(true);
  });

  it('stops suggesting filesystem inputs after five inputs (only prompt hint remains)', async () => {
    const suggestions = await completeImageCommand(
      'out.png a.png b.png c.png d.png e.png ',
      workspaceRoot,
    );
    // No filesystem inputs after the five-input limit...
    expect(suggestions.some((s) => s.includes('cat.png'))).toBe(false);
    expect(suggestions.some((s) => s.includes('dog.png'))).toBe(false);
    // ...but the prompt continuation is still discoverable.
    expect(suggestions.some((s) => s.startsWith('"'))).toBe(true);
  });

  it('returns no filesystem completions once the prompt begins', async () => {
    const suggestions = await completeImageCommand(
      'out.png "draw a cat',
      workspaceRoot,
    );
    expect(suggestions).toStrictEqual([]);
  });

  it('correctly quotes paths with spaces', async () => {
    await fs.promises.writeFile(
      path.join(workspaceRoot, 'my image.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    const suggestions = await completeImageCommand('out.png ', workspaceRoot);
    expect(suggestions.some((s) => s.includes('"my image.png"'))).toBe(true);
  });

  it('filters suggestions by the partial prefix', async () => {
    const suggestions = await completeImageCommand(
      'out.png cat',
      workspaceRoot,
    );
    expect(suggestions.some((s) => s.includes('cat.png'))).toBe(true);
    expect(suggestions.some((s) => s.includes('dog.png'))).toBe(false);
  });

  it('returns no suggestions for an absolute prefix outside the workspace', async () => {
    const suggestions = await completeImageCommand(
      'out.png /etc/',
      workspaceRoot,
    );
    expect(suggestions).toStrictEqual([]);
  });

  it('returns no suggestions for a ../ traversal prefix', async () => {
    const suggestions = await completeImageCommand(
      'out.png ../',
      workspaceRoot,
    );
    expect(suggestions).toStrictEqual([]);
  });
});
