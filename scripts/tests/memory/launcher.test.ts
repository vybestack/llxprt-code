/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the memprofile launcher (scripts/memory/launcher.ts):
 * fail-fast option parsing with the `--` passthrough boundary, the explicit
 * LLXPRT_MEM_SNAPSHOT disarming of inherited environments, atomic `latest`
 * pointer publishing, and env construction.
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type LauncherOptions,
  LauncherParseError,
  buildLauncherEnv,
  parseLauncherArgs,
  publishLatestPointer,
} from '../../memory/launcher.ts';
import {
  DEFAULT_MAX_SNAPSHOT_HEAP_MB,
  MAX_INTERVAL_MS,
  MAX_SNAPSHOT_HEAP_MB_LIMIT,
} from '../../memory/probe.ts';
import { devLocalStorageFile } from '../../lib/node-options.ts';

describe('parseLauncherArgs — defaults and recognized options', () => {
  it('applies documented defaults for an empty argv', () => {
    const options = parseLauncherArgs([], '/default/run');
    expect(options.snapshots).toBe(false);
    expect(options.intervalMs).toBe(15_000);
    expect(options.maxHeapMb).toBe(DEFAULT_MAX_SNAPSHOT_HEAP_MB);
    expect(options.runDir).toBe('/default/run');
    expect(options.passthrough).toEqual([]);
    expect(options.help).toBe(false);
  });

  it('parses every recognized option', () => {
    const options = parseLauncherArgs(
      [
        '--snapshots',
        '--interval',
        '5000',
        '--max-heap-mb',
        '128',
        '--dir',
        '/r',
      ],
      '/default/run',
    );
    expect(options.snapshots).toBe(true);
    expect(options.intervalMs).toBe(5000);
    expect(options.maxHeapMb).toBe(128);
    expect(options.runDir).toBe('/r');
  });

  it('accepts both -h and --help', () => {
    expect(parseLauncherArgs(['-h'], '/d').help).toBe(true);
    expect(parseLauncherArgs(['--help'], '/d').help).toBe(true);
  });
});

describe('parseLauncherArgs — -- passthrough boundary', () => {
  it('passes everything after -- to LLxprt untouched', () => {
    const options = parseLauncherArgs(
      [
        '--snapshots',
        '--',
        '--profile-load',
        'ollama',
        '--weird',
        'positional',
      ],
      '/d',
    );
    expect(options.snapshots).toBe(true);
    expect(options.passthrough).toEqual([
      '--profile-load',
      'ollama',
      '--weird',
      'positional',
    ]);
  });

  it('passes a lone -- through as empty passthrough', () => {
    const options = parseLauncherArgs(['--'], '/d');
    expect(options.passthrough).toEqual([]);
  });

  it('fails fast on an unknown option before --', () => {
    expect(() => parseLauncherArgs(['--unknown'], '/d')).toThrow(
      LauncherParseError,
    );
    expect(() => parseLauncherArgs(['--unknown'], '/d')).toThrow(
      /unknown option: --unknown/,
    );
  });

  it('fails fast on an unknown LLxprt-style option before --', () => {
    // The whole point of the boundary: forgetting -- must fail loudly instead
    // of silently forwarding a launcher-consumed flag to LLxprt.
    expect(() => parseLauncherArgs(['--profile-load', 'x'], '/d')).toThrow(
      /unknown option/,
    );
  });
});

describe('parseLauncherArgs — invalid values fail fast', () => {
  it('rejects a missing value for --interval', () => {
    expect(() => parseLauncherArgs(['--interval'], '/d')).toThrow(
      /missing value for --interval/,
    );
  });

  it('rejects a flag-shaped value for --interval', () => {
    expect(() =>
      parseLauncherArgs(['--interval', '--snapshots'], '/d'),
    ).toThrow(/invalid value for --interval/);
  });

  it('rejects a negative interval', () => {
    expect(() => parseLauncherArgs(['--interval', '-5'], '/d')).toThrow(
      /invalid value for --interval/,
    );
  });

  it('rejects a zero interval', () => {
    expect(() => parseLauncherArgs(['--interval', '0'], '/d')).toThrow(
      /invalid value for --interval/,
    );
  });

  it('rejects a non-integer interval', () => {
    expect(() => parseLauncherArgs(['--interval', '1.5'], '/d')).toThrow(
      /invalid value for --interval/,
    );
  });

  it('rejects a nonfinite interval', () => {
    expect(() => parseLauncherArgs(['--interval', 'Infinity'], '/d')).toThrow(
      /invalid value for --interval/,
    );
    expect(() => parseLauncherArgs(['--interval', 'NaN'], '/d')).toThrow(
      /invalid value for --interval/,
    );
  });

  it('rejects a non-numeric max-heap', () => {
    expect(() => parseLauncherArgs(['--max-heap-mb', 'big'], '/d')).toThrow(
      /invalid value for --max-heap-mb/,
    );
  });

  it('rejects a missing value for --dir', () => {
    expect(() => parseLauncherArgs(['--dir'], '/d')).toThrow(
      /missing value for --dir/,
    );
  });

  it('rejects a flag-shaped value for --dir', () => {
    expect(() => parseLauncherArgs(['--dir', '--snapshots'], '/d')).toThrow(
      /invalid value for --dir/,
    );
  });

  it('rejects an interval above the upper bound', () => {
    expect(() =>
      parseLauncherArgs(['--interval', String(MAX_INTERVAL_MS + 1)], '/d'),
    ).toThrow(/--interval/);
  });

  it('rejects a heap guard above the upper bound', () => {
    expect(() =>
      parseLauncherArgs(
        ['--max-heap-mb', String(MAX_SNAPSHOT_HEAP_MB_LIMIT + 1)],
        '/d',
      ),
    ).toThrow(/--max-heap-mb/);
  });

  it('accepts values exactly at the bounds', () => {
    expect(
      parseLauncherArgs(['--interval', String(MAX_INTERVAL_MS)], '/d')
        .intervalMs,
    ).toBe(MAX_INTERVAL_MS);
    expect(
      parseLauncherArgs(
        ['--max-heap-mb', String(MAX_SNAPSHOT_HEAP_MB_LIMIT)],
        '/d',
      ).maxHeapMb,
    ).toBe(MAX_SNAPSHOT_HEAP_MB_LIMIT);
  });

  it('points a forgotten boundary at the -- separator in the error hint', () => {
    try {
      parseLauncherArgs(['--profile-load', 'x'], '/d');
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(LauncherParseError);
      expect((error as LauncherParseError).message).toContain('after --');
    }
  });
});

describe('buildLauncherEnv — exactly one launcher-owned --localstorage-file', () => {
  const options: LauncherOptions = {
    snapshots: false,
    intervalMs: 15_000,
    maxHeapMb: 256,
    runDir: '/run',
    help: false,
    passthrough: [],
  };

  const occurrences = (env: NodeJS.ProcessEnv): number =>
    (env['NODE_OPTIONS'] ?? '').split('--localstorage-file=').length - 1;

  it('adds exactly one value when NODE_OPTIONS is empty or absent', () => {
    expect(occurrences(buildLauncherEnv({}, options, '1.0.0'))).toBe(1);
    expect(
      occurrences(buildLauncherEnv({ NODE_OPTIONS: '' }, options, '1.0.0')),
    ).toBe(1);
  });

  it('strips inherited --localstorage-file variants before adding its own', () => {
    const inherited = [
      '--localstorage-file=/tmp/old-a',
      '--localstorage-file=/tmp/old-b',
    ].join(' ');
    const env = buildLauncherEnv({ NODE_OPTIONS: inherited }, options, '1.0.0');
    expect(occurrences(env)).toBe(1);
    expect(env['NODE_OPTIONS']).toContain(
      `--localstorage-file=${devLocalStorageFile()}`,
    );
    expect(env['NODE_OPTIONS']).not.toContain('/tmp/old-a');
    expect(env['NODE_OPTIONS']).not.toContain('/tmp/old-b');
  });

  it('strips space-separated and =-attached inherited forms', () => {
    const inherited =
      '--localstorage-file /tmp/space-form --other-flag --localstorage-file=/tmp/eq-form';
    const env = buildLauncherEnv({ NODE_OPTIONS: inherited }, options, '1.0.0');
    expect(occurrences(env)).toBe(1);
    expect(env['NODE_OPTIONS']).not.toContain('/tmp/space-form');
    expect(env['NODE_OPTIONS']).not.toContain('/tmp/eq-form');
    expect(env['NODE_OPTIONS']).toContain('--other-flag');
  });

  it('preserves unrelated inherited NODE_OPTIONS content', () => {
    const env = buildLauncherEnv(
      { NODE_OPTIONS: '--experimental-wasm-interface-types' },
      options,
      '1.0.0',
    );
    expect(env['NODE_OPTIONS']).toContain(
      '--experimental-wasm-interface-types',
    );
    expect(occurrences(env)).toBe(1);
  });
});

describe('buildLauncherEnv — snapshot arming is immune to inheritance', () => {
  const baseOptions = (snapshots: boolean): LauncherOptions => ({
    snapshots,
    intervalMs: 15_000,
    maxHeapMb: 256,
    runDir: '/run',
    help: false,
    passthrough: [],
  });

  it('sets LLXPRT_MEM_SNAPSHOT=1 when armed', () => {
    const env = buildLauncherEnv({}, baseOptions(true), '1.0.0');
    expect(env['LLXPRT_MEM_SNAPSHOT']).toBe('1');
  });

  it('explicitly sets LLXPRT_MEM_SNAPSHOT=0 when unarmed, overriding an inherited 1', () => {
    // A parent that exported LLXPRT_MEM_SNAPSHOT=1 must not silently arm
    // snapshots in a child launched without --snapshots.
    const env = buildLauncherEnv(
      { LLXPRT_MEM_SNAPSHOT: '1' },
      baseOptions(false),
      '1.0.0',
    );
    expect(env['LLXPRT_MEM_SNAPSHOT']).toBe('0');
  });

  it('propagates run dir, interval, and guard', () => {
    const env = buildLauncherEnv({}, baseOptions(false), '1.0.0');
    expect(env['LLXPRT_MEM_DIR']).toBe('/run');
    expect(env['LLXPRT_MEM_INTERVAL_MS']).toBe('15000');
    expect(env['LLXPRT_MEM_MAX_HEAP_MB']).toBe('256');
    expect(env['DEV']).toBe('true');
    expect(env['CLI_VERSION']).toBe('1.0.0');
  });
});

describe('publishLatestPointer — atomic same-directory publish', () => {
  it('publishes the pointer and leaves no temp file behind', () => {
    const root = mkdtempSync(join(tmpdir(), 'memprofile-pub-'));
    try {
      publishLatestPointer(root, '/runs/run-a');
      expect(readFileSync(join(root, 'latest'), 'utf8')).toBe('/runs/run-a');
      const leftovers = readdirSync(root).filter((n) => n.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('overwrites a previous pointer atomically', () => {
    const root = mkdtempSync(join(tmpdir(), 'memprofile-pub2-'));
    try {
      publishLatestPointer(root, '/runs/run-a');
      publishLatestPointer(root, '/runs/run-b');
      expect(readFileSync(join(root, 'latest'), 'utf8')).toBe('/runs/run-b');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
