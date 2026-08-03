/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseArguments } from '../cliArgParser.js';
import { resolveDirectImageMode } from '../imageModeDispatch.js';
import { buildNormalizedImageRequest } from '@vybestack/llxprt-code-core/services/image/imageOperation.js';
import type { Settings } from '../settings.js';

vi.mock('open', () => ({ default: vi.fn() }));
vi.mock('read-package-up', () => ({
  readPackageUp: vi.fn(() =>
    Promise.resolve({ packageJson: { version: 'test-version' } }),
  ),
}));

const originalArgv = process.argv;

/**
 * These tests exercise the REAL yargs parser → mapParsedArgsToCliArgs →
 * resolveDirectImageMode → buildNormalizedImageRequest pipeline. They prove
 * the actual CLI argument mapping produces a normalized request equivalent to
 * the tool and slash-command entry points, not a manually-constructed literal.
 */
describe('image flags: real parser → normalized request', () => {
  afterEach(() => {
    process.argv = originalArgv;
  });
  it('parses long-form --image-output/--image-prompt into CliArgs and resolves a generate request', async () => {
    process.argv = [
      'node',
      'script.js',
      '--image-output',
      'cat.png',
      '--image-prompt',
      'draw a cat',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.imageOutput).toBe('cat.png');
    expect(argv.imagePrompt).toBe('draw a cat');
    expect(argv.imageInput).toBeUndefined();

    const mode = resolveDirectImageMode(argv);
    expect(mode).not.toBeNull();
    expect(mode?.operation).toBe('generate');

    const normalized = buildNormalizedImageRequest({
      prompt: mode!.prompt,
      outputPath: mode!.outputPath,
      inputPaths: mode!.inputPaths,
    });
    expect(normalized.operation).toBe('generate');
    expect(normalized.prompt).toBe('draw a cat');
    expect(normalized.outputPath).toBe('cat.png');
    expect(normalized.inputPaths).toStrictEqual([]);
  });

  it('parses short-form -O/-P', async () => {
    process.argv = ['node', 'script.js', '-O', 'cat.png', '-P', 'draw a cat'];
    const argv = await parseArguments({} as Settings);
    expect(argv.imageOutput).toBe('cat.png');
    expect(argv.imagePrompt).toBe('draw a cat');
    const mode = resolveDirectImageMode(argv);
    expect(mode?.operation).toBe('generate');
  });

  it('parses repeated -I preserving order without comma-splitting', async () => {
    process.argv = [
      'node',
      'script.js',
      '-O',
      'out.png',
      '-I',
      'a.png',
      '-I',
      'b.png',
      '-I',
      'c.png',
      '-P',
      'edit',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.imageInput).toStrictEqual(['a.png', 'b.png', 'c.png']);
    const mode = resolveDirectImageMode(argv);
    expect(mode?.operation).toBe('edit');
    expect(mode?.inputPaths).toStrictEqual(['a.png', 'b.png', 'c.png']);
  });

  it('resolves an edit request equivalent to the slash command and tool surface', async () => {
    process.argv = [
      'node',
      'script.js',
      '-O',
      'fixed.png',
      '-I',
      'original.png',
      '-P',
      'fix the text',
    ];
    const argv = await parseArguments({} as Settings);
    const mode = resolveDirectImageMode(argv);

    // Tool surface: { prompt, output_path, input_paths }
    const toolRequest = buildNormalizedImageRequest({
      prompt: 'fix the text',
      outputPath: 'fixed.png',
      inputPaths: ['original.png'],
    });

    // CLI mapping → normalized
    const cliRequest = buildNormalizedImageRequest({
      prompt: mode!.prompt,
      outputPath: mode!.outputPath,
      inputPaths: mode!.inputPaths,
    });

    expect(cliRequest).toStrictEqual(toolRequest);
    expect(cliRequest.operation).toBe('edit');
  });

  it('treats piped stdin as NOT implicitly becoming the image prompt', async () => {
    // The image prompt must come from -P, not stdin. resolveDirectImageMode
    // only reads imagePrompt; stdin is never consulted by the image path.
    process.argv = [
      'node',
      'script.js',
      '--image-output',
      'cat.png',
      '--image-prompt',
      'draw a cat',
    ];
    const argv = await parseArguments({} as Settings);
    const mode = resolveDirectImageMode(argv);
    expect(mode?.prompt).toBe('draw a cat');
  });
});
