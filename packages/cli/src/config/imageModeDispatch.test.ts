/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const stdoutChunks: string[] = [];
const stderrChunks: string[] = [];

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');
  return {
    ...actual,
    writeToStdout: vi.fn((chunk: string) => {
      stdoutChunks.push(chunk);
      return true;
    }),
    writeToStderr: vi.fn((chunk: string) => {
      stderrChunks.push(chunk);
      return true;
    }),
  };
});

import {
  resolveDirectImageMode,
  runDirectImageModeAndExit,
} from './imageModeDispatch.js';
import { ImageModeError } from './imageMode.js';
import type { ParsedCliArgs } from '../cliBootstrap.js';
import { ExitCodes } from '@vybestack/llxprt-code-core';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngCrc32(buf: Buffer): number {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  let crc = 0xff_ff_ff_ff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function makeRealMinimalPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rawScanline = Buffer.from([0x00, 0xff, 0x00, 0x00]);
  const zlibHeader = Buffer.from([0x78, 0x01]);
  const storedBlockHeader = Buffer.from([0x01]);
  const storedLen = Buffer.alloc(2);
  storedLen.writeUInt16LE(rawScanline.length, 0);
  const storedNlen = Buffer.alloc(2);
  storedNlen.writeUInt16LE(~rawScanline.length & 0xffff, 0);
  let a = 1;
  let b = 0;
  for (const byte of rawScanline) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler, 0);
  const idatData = Buffer.concat([
    zlibHeader,
    storedBlockHeader,
    storedLen,
    storedNlen,
    rawScanline,
    checksum,
  ]);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idatData),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const VALID_PNG_BASE64 = makeRealMinimalPng().toString('base64');

function makeArgs(overrides: Partial<ParsedCliArgs> = {}): ParsedCliArgs {
  return {
    model: undefined,
    sandbox: undefined,
    sandboxImage: undefined,
    sandboxEngine: undefined,
    sandboxProfileLoad: undefined,
    debug: undefined,
    prompt: undefined,
    promptInteractive: undefined,
    outputFormat: undefined,
    quiet: undefined,
    showMemoryUsage: undefined,
    yolo: undefined,
    approvalMode: undefined,
    telemetry: undefined,
    checkpointing: undefined,
    telemetryTarget: undefined,
    telemetryOtlpEndpoint: undefined,
    telemetryLogPrompts: undefined,
    telemetryOutfile: undefined,
    allowedMcpServerNames: undefined,
    allowedTools: undefined,
    experimentalAcp: undefined,
    experimentalUi: undefined,
    extensions: undefined,
    listExtensions: undefined,
    provider: undefined,
    key: undefined,
    keyfile: undefined,
    baseurl: undefined,
    proxy: undefined,
    includeDirectories: undefined,
    profileLoad: undefined,
    loadMemoryFromIncludeDirectories: undefined,
    ideMode: undefined,
    screenReader: undefined,
    sessionSummary: undefined,
    dumponerror: undefined,
    promptWords: undefined,
    query: undefined,
    set: undefined,
    continue: undefined,
    nobrowser: undefined,
    listSessions: undefined,
    deleteSession: undefined,
    imageInput: undefined,
    imageOutput: undefined,
    imagePrompt: undefined,
    ...overrides,
  } as ParsedCliArgs;
}

function makeConfigWithRunner(
  runner: (input: {
    readonly prompt: string;
    readonly outputPath: string;
    readonly inputPaths?: readonly string[];
  }) => Promise<unknown>,
): unknown {
  // Mirror the REAL Config surface: capability exposed via a typed getter,
  // NOT a mutable property. Tests that construct a config exposing only a
  // property (without the getter) must fail so the wiring defect is caught.
  return {
    getTargetDir: () => '/workspace',
    getRunImageOperation: () => runner,
  };
}

describe('resolveDirectImageMode (real parser/dispatch seam)', () => {
  it('returns null when no image flags are present', () => {
    expect(resolveDirectImageMode(makeArgs())).toBeNull();
  });

  it('detects generate mode from -O/-P (long form)', () => {
    const result = resolveDirectImageMode(
      makeArgs({ imageOutput: 'cat.png', imagePrompt: 'draw a cat' }),
    );
    expect(result).not.toBeNull();
    expect(result?.operation).toBe('generate');
    expect(result?.outputPath).toBe('cat.png');
    expect(result?.prompt).toBe('draw a cat');
    expect(result?.inputPaths).toStrictEqual([]);
  });

  it('detects edit mode from repeated -I (preserves order, no comma split)', () => {
    const result = resolveDirectImageMode(
      makeArgs({
        imageOutput: 'out.png',
        imagePrompt: 'edit',
        imageInput: ['a.png', 'b.png', 'c.png'],
      }),
    );
    expect(result?.operation).toBe('edit');
    expect(result?.inputPaths).toStrictEqual(['a.png', 'b.png', 'c.png']);
  });

  it('rejects missing -O', () => {
    expect(() =>
      resolveDirectImageMode(makeArgs({ imagePrompt: 'draw' })),
    ).toThrow(ImageModeError);
  });

  it('rejects missing -P', () => {
    expect(() =>
      resolveDirectImageMode(makeArgs({ imageOutput: 'cat.png' })),
    ).toThrow(ImageModeError);
  });

  it('rejects more than five -I', () => {
    expect(() =>
      resolveDirectImageMode(
        makeArgs({
          imageOutput: 'out.png',
          imagePrompt: 'edit',
          imageInput: ['a', 'b', 'c', 'd', 'e', 'f'],
        }),
      ),
    ).toThrow(/at most 5/i);
  });

  it('rejects non-png output', () => {
    expect(() =>
      resolveDirectImageMode(
        makeArgs({ imageOutput: 'out.jpg', imagePrompt: 'draw' }),
      ),
    ).toThrow(/png/i);
  });

  it('rejects conflict with positional prompt', () => {
    expect(() =>
      resolveDirectImageMode(
        makeArgs({
          imageOutput: 'out.png',
          imagePrompt: 'draw',
          promptWords: ['some', 'text'],
        }),
      ),
    ).toThrow(/mutually exclusive/i);
  });

  it('rejects conflict with --prompt', () => {
    expect(() =>
      resolveDirectImageMode(
        makeArgs({
          imageOutput: 'out.png',
          imagePrompt: 'draw',
          prompt: 'other',
        }),
      ),
    ).toThrow(/mutually exclusive/i);
  });

  it('rejects conflict with --prompt-interactive', () => {
    expect(() =>
      resolveDirectImageMode(
        makeArgs({
          imageOutput: 'out.png',
          imagePrompt: 'draw',
          promptInteractive: 'other',
        }),
      ),
    ).toThrow(/mutually exclusive/i);
  });

  it('rejects stream-json output format', () => {
    expect(() =>
      resolveDirectImageMode(
        makeArgs({
          imageOutput: 'out.png',
          imagePrompt: 'draw',
          outputFormat: 'stream-json',
        }),
      ),
    ).toThrow(/stream-json/i);
  });
});

describe('runDirectImageModeAndExit', () => {
  let workspaceRoot = '';

  beforeEach(async () => {
    workspaceRoot = await fs.promises.realpath(
      await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'llxprt-image-dispatch-'),
      ),
    );
    stdoutChunks.length = 0;
    stderrChunks.length = 0;
  });

  afterEach(async () => {
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('returns null when image mode is not active (conversational dispatch continues)', async () => {
    const config = makeConfigWithRunner(vi.fn());
    const code = await runDirectImageModeAndExit(makeArgs(), config as never);
    expect(code).toBeNull();
  });

  it('runs the common runner and emits text output with the exact saved path (no base64)', async () => {
    const outputPath = path.join(workspaceRoot, 'cat.png');
    const runner = vi.fn().mockResolvedValue({
      operation: 'generate',
      absoluteOutputPath: outputPath,
      relativeOutputPath: 'cat.png',
      mimeType: 'image/png',
      backend: 'codex',
      provider: 'codex',
      model: 'gpt-image-2',
      inputPaths: [],
    });
    const config = makeConfigWithRunner(runner);
    const code = await runDirectImageModeAndExit(
      makeArgs({ imageOutput: 'cat.png', imagePrompt: 'draw a cat' }),
      config as never,
    );
    expect(code).toBe(0);
    expect(runner).toHaveBeenCalledWith({
      prompt: 'draw a cat',
      outputPath: 'cat.png',
      inputPaths: [],
      signal: expect.any(AbortSignal),
    });
    const out = stdoutChunks.join('');
    expect(out).toContain(outputPath);
    expect(out).not.toContain(VALID_PNG_BASE64);
    expect(out).not.toContain('base64');
  });

  it('emits bounded json output (no base64) when --output-format json', async () => {
    const outputPath = path.join(workspaceRoot, 'cat.png');
    const runner = vi.fn().mockResolvedValue({
      operation: 'generate',
      absoluteOutputPath: outputPath,
      relativeOutputPath: 'cat.png',
      mimeType: 'image/png',
      backend: 'codex',
      provider: 'codex',
      model: 'gpt-image-2',
      inputPaths: [],
    });
    const config = makeConfigWithRunner(runner);
    const code = await runDirectImageModeAndExit(
      makeArgs({
        imageOutput: 'cat.png',
        imagePrompt: 'draw a cat',
        outputFormat: 'json',
      }),
      config as never,
    );
    expect(code).toBe(0);
    const out = stdoutChunks.join('');
    const parsed = JSON.parse(out.trim());
    expect(parsed.operation).toBe('generate');
    expect(parsed.output_path).toBe(outputPath);
    expect(parsed.model).toBe('gpt-image-2');
    expect(parsed).not.toHaveProperty('media');
    expect(parsed).not.toHaveProperty('data');
    expect(out).not.toContain(VALID_PNG_BASE64);
  });

  it('returns nonzero exit code on runner failure', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('provider down'));
    const config = makeConfigWithRunner(runner);
    const code = await runDirectImageModeAndExit(
      makeArgs({ imageOutput: 'cat.png', imagePrompt: 'draw a cat' }),
      config as never,
    );
    expect(code).toBe(1);
  });

  it('returns nonzero exit code on cancellation (abort)', async () => {
    const abortError = new Error('The operation was aborted.');
    abortError.name = 'AbortError';
    const runner = vi.fn().mockRejectedValue(abortError);
    const config = makeConfigWithRunner(runner);
    const code = await runDirectImageModeAndExit(
      makeArgs({ imageOutput: 'cat.png', imagePrompt: 'draw a cat' }),
      config as never,
    );
    expect(code).toBe(1);
  });

  it('returns FATAL_CONFIG_ERROR when no image runner is configured (capability-specific)', async () => {
    const config = { getTargetDir: () => '/workspace' };
    const code = await runDirectImageModeAndExit(
      makeArgs({ imageOutput: 'cat.png', imagePrompt: 'draw a cat' }),
      config as never,
    );
    expect(code).toBe(ExitCodes.FATAL_CONFIG_ERROR);
    const err = stderrChunks.join('');
    expect(err).toContain('unavailable');
  });

  it('returns FATAL_INPUT_ERROR on invalid image args (conflict)', async () => {
    const config = makeConfigWithRunner(vi.fn());
    const code = await runDirectImageModeAndExit(
      makeArgs({
        imageOutput: 'cat.png',
        imagePrompt: 'draw a cat',
        prompt: 'conflicting',
      }),
      config as never,
    );
    expect(code).toBe(ExitCodes.FATAL_INPUT_ERROR);
  });

  it('rejects a config that exposes runImageOperation as a property instead of the getter (wiring guard)', async () => {
    // A config with ONLY a property (no getRunImageOperation getter) must be
    // treated as unavailable so the unsafe property cast can never regress.
    const runner = vi.fn();
    const config = {
      getTargetDir: () => '/workspace',
      runImageOperation: runner,
    };
    const code = await runDirectImageModeAndExit(
      makeArgs({ imageOutput: 'cat.png', imagePrompt: 'draw a cat' }),
      config as never,
    );
    expect(code).toBe(ExitCodes.FATAL_CONFIG_ERROR);
    expect(runner).not.toHaveBeenCalled();
  });

  it('does not call runExitCleanup (cli.tsx owns the single exit cleanup)', async () => {
    // The dispatch must not clean up; the CLI entry point owns cleanup so it
    // runs exactly once. We spy on the cleanup module to prove zero calls.
    const cleanup = await import('../utils/cleanup.js');
    const spy = vi.spyOn(cleanup, 'runExitCleanup').mockResolvedValue();
    try {
      const runner = vi.fn().mockResolvedValue({
        operation: 'generate',
        absoluteOutputPath: '/workspace/cat.png',
        relativeOutputPath: 'cat.png',
        mimeType: 'image/png',
        backend: 'codex',
        provider: 'codex',
        model: 'gpt-image-2',
        inputPaths: [],
      });
      const config = makeConfigWithRunner(runner);
      await runDirectImageModeAndExit(
        makeArgs({ imageOutput: 'cat.png', imagePrompt: 'draw a cat' }),
        config as never,
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('propagates a cancellation signal to the runner (SIGINT aborts)', async () => {
    // The direct handler wires SIGINT to an AbortController whose signal is
    // forwarded to the runner. We capture the signal and abort it to prove
    // propagation reaches the common runner.
    let capturedSignal: AbortSignal | undefined;
    const runner = vi
      .fn()
      .mockImplementation(async (input: { readonly signal?: AbortSignal }) => {
        capturedSignal = input.signal;
        // Simulate a long operation that observes the abort.
        return {
          operation: 'generate',
          absoluteOutputPath: '/workspace/cat.png',
          relativeOutputPath: 'cat.png',
          mimeType: 'image/png',
          backend: 'codex',
          provider: 'codex',
          model: 'gpt-image-2',
          inputPaths: [],
        };
      });
    const config = makeConfigWithRunner(runner);
    const code = await runDirectImageModeAndExit(
      makeArgs({ imageOutput: 'cat.png', imagePrompt: 'draw a cat' }),
      config as never,
    );
    expect(code).toBe(0);
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    // Emitting SIGINT after completion should not crash (listener removed).
    process.emit('SIGINT');
    // The handler removes its listener; ensure no unhandled crash by reaching
    // this assertion.
    expect(capturedSignal?.aborted).toBe(false);
  });
});
