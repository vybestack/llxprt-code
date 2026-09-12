/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as fs from 'node:fs';
import { join } from 'node:path';
import {
  RealHomeSentinelGuard,
  RealHomeSentinelViolation,
  SENTINEL_GUARD_DISABLE_ENV,
  createRealHomeSentinelGuard,
  resolveRealHomeSentinelTargets,
  type SentinelTargetDir,
} from '../lib/real-home-sentinel.js';

const LABEL = 'leaky.test.ts';

/**
 * Shared temp fake-home helper (RULES.md "DRY setup"). Registers its own
 * beforeEach/afterEach hooks and returns a lazy accessor.
 */
function useFakeHome(): () => string {
  let home = '';
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'real-home-sentinel-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });
  return () => {
    if (home === '') {
      throw new Error('Fake home accessed outside its lifecycle');
    }
    return home;
  };
}

/** Runs the call and returns the sentinel violation it threw, if any. */
function captureViolation(call: () => void): RealHomeSentinelViolation | void {
  try {
    call();
  } catch (error) {
    if (error instanceof RealHomeSentinelViolation) {
      return error;
    }
    throw error;
  }
}

function targetFor(path: string): SentinelTargetDir {
  return { path, description: 'test target' };
}

describe('RealHomeSentinelGuard baseline', () => {
  const getHome = useFakeHome();

  it('drops a sentinel file into each existing target dir at baseline', () => {
    const watched = join(getHome(), '.llxprt');
    mkdirSync(watched);
    const guard = new RealHomeSentinelGuard({
      targets: [targetFor(watched)],
      sessionId: 'session-a',
    });

    guard.captureBaseline();

    expect(existsSync(join(watched, '.llxprt-sentinel-session-a'))).toBe(true);
  });

  it('records an absent target dir as must-not-appear without creating it', () => {
    const absent = join(getHome(), '.llxprt');
    const guard = new RealHomeSentinelGuard({
      targets: [targetFor(absent)],
      sessionId: 'session-a',
    });

    guard.captureBaseline();

    expect(existsSync(absent)).toBe(false);
  });
});

describe('RealHomeSentinelGuard assertUnchanged', () => {
  const getHome = useFakeHome();

  /** A watched dir with one pre-existing real entry, guarded each test. */
  function watchedDir(): string {
    const dir = join(getHome(), '.llxprt');
    mkdirSync(dir);
    writeFileSync(join(dir, 'settings.json'), '{}');
    return dir;
  }

  it('passes when nothing changed', () => {
    const dir = watchedDir();
    const guard = new RealHomeSentinelGuard({
      targets: [targetFor(dir)],
      sessionId: 'session-a',
    });
    guard.captureBaseline();

    expect(
      captureViolation(() => guard.assertUnchanged(LABEL)),
    ).toBeUndefined();
  });

  it('reports an unrelated writer only at first detection, not against later files', async () => {
    const dir = watchedDir();
    const guard = new RealHomeSentinelGuard({ targets: [targetFor(dir)] });
    guard.captureBaseline();
    const writer = Bun.spawn([
      process.execPath,
      '-e',
      `require('node:fs').writeFileSync(process.argv[1], '{}')`,
      join(dir, 'external.json'),
    ]);
    expect(await writer.exited).toBe(0);

    const first = captureViolation(() => guard.assertUnchanged('A.test.ts'));
    expect(first?.kind).toBe('non-sentinel entry added');
    expect(first?.message).toContain('detected while running A.test.ts');
    expect(first?.message).toContain('per-file attribution is best-effort');
    expect(first?.message).toContain(`test target (${dir})`);
    expect(
      captureViolation(() => guard.assertUnchanged('B.test.ts')),
    ).toBeUndefined();

    writeFileSync(join(dir, 'another.json'), '{}');
    const next = captureViolation(() => guard.assertUnchanged('C.test.ts'));
    expect(next?.message).toContain('another.json');
    expect(next?.message).not.toContain('external.json');
    expect(
      captureViolation(() => guard.assertUnchanged('teardown')),
    ).toBeUndefined();
    guard.cleanup();
  });

  it('does not defer simultaneous distinct changes to later labels', () => {
    const dir = watchedDir();
    const guard = new RealHomeSentinelGuard({ targets: [targetFor(dir)] });
    guard.captureBaseline();
    writeFileSync(join(dir, 'new.json'), '{}');
    rmSync(join(dir, 'settings.json'));
    const first = captureViolation(() => guard.assertUnchanged('A.test.ts'));
    expect(first?.message).toContain('new.json');
    expect(first?.message).toContain('settings.json');
    expect(
      captureViolation(() => guard.assertUnchanged('B.test.ts')),
    ).toBeUndefined();
    guard.cleanup();
  });

  it('fails naming the file and kind when the sentinel content is modified', () => {
    const dir = watchedDir();
    const guard = new RealHomeSentinelGuard({
      targets: [targetFor(dir)],
      sessionId: 'session-a',
    });
    guard.captureBaseline();
    writeFileSync(join(dir, '.llxprt-sentinel-session-a'), 'tampered');

    const violation = captureViolation(() => guard.assertUnchanged(LABEL));
    expect(violation).toBeDefined();
    expect(violation?.kind).toBe('sentinel modified');
    expect(violation?.label).toBe(LABEL);
    expect(violation?.message).toContain(LABEL);
    expect(violation?.message).toContain(dir);
  });

  it('fails when the sentinel is removed', () => {
    const dir = watchedDir();
    const guard = new RealHomeSentinelGuard({
      targets: [targetFor(dir)],
      sessionId: 'session-a',
    });
    guard.captureBaseline();
    rmSync(join(dir, '.llxprt-sentinel-session-a'));

    const violation = captureViolation(() => guard.assertUnchanged(LABEL));
    expect(violation?.kind).toBe('sentinel removed');
    expect(violation?.label).toBe(LABEL);
  });

  it('fails when an absent target dir appears', () => {
    const dir = join(getHome(), '.llxprt');
    const guard = new RealHomeSentinelGuard({
      targets: [targetFor(dir)],
      sessionId: 'session-a',
    });
    guard.captureBaseline();
    mkdirSync(dir);

    const violation = captureViolation(() => guard.assertUnchanged(LABEL));
    expect(violation?.kind).toBe('dir appeared');
    expect(violation?.targetPath).toBe(dir);
  });

  it('fails when a non-sentinel entry is added to a watched dir', () => {
    const dir = watchedDir();
    const guard = new RealHomeSentinelGuard({
      targets: [targetFor(dir)],
      sessionId: 'session-a',
    });
    guard.captureBaseline();
    writeFileSync(join(dir, 'leaked-settings.json'), '{}');

    const violation = captureViolation(() => guard.assertUnchanged(LABEL));
    expect(violation?.kind).toBe('non-sentinel entry added');
    expect(violation?.message).toContain('leaked-settings.json');
  });

  it('fails when a watched entry is removed', () => {
    const dir = watchedDir();
    const guard = new RealHomeSentinelGuard({
      targets: [targetFor(dir)],
      sessionId: 'session-a',
    });
    guard.captureBaseline();
    rmSync(join(dir, 'settings.json'));

    const violation = captureViolation(() => guard.assertUnchanged(LABEL));
    expect(violation?.kind).toBe('non-sentinel entry removed');
    expect(violation?.message).toContain('settings.json');
  });

  it('does not treat another session sentinel appearing as a violation', () => {
    const dir = watchedDir();
    const mine = new RealHomeSentinelGuard({
      targets: [targetFor(dir)],
      sessionId: 'session-a',
    });
    const sibling = new RealHomeSentinelGuard({
      targets: [targetFor(dir)],
      sessionId: 'session-b',
    });
    mine.captureBaseline();
    sibling.captureBaseline();

    expect(captureViolation(() => mine.assertUnchanged(LABEL))).toBeUndefined();
  });
});

describe('RealHomeSentinelGuard cleanup', () => {
  const getHome = useFakeHome();

  it('removes only this guard sentinels, leaving sibling sentinels alone', () => {
    const dir = join(getHome(), '.llxprt');
    mkdirSync(dir);
    const mine = new RealHomeSentinelGuard({
      targets: [targetFor(dir)],
      sessionId: 'session-a',
    });
    const sibling = new RealHomeSentinelGuard({
      targets: [targetFor(dir)],
      sessionId: 'session-b',
    });
    mine.captureBaseline();
    sibling.captureBaseline();

    mine.cleanup();

    expect(existsSync(join(dir, '.llxprt-sentinel-session-a'))).toBe(false);
    expect(existsSync(join(dir, '.llxprt-sentinel-session-b'))).toBe(true);
  });

  it('cleans earlier sentinels when a later target cannot capture its baseline', () => {
    const first = join(getHome(), 'first');
    const second = join(getHome(), 'second');
    mkdirSync(first);
    mkdirSync(second);
    mkdirSync(join(second, '.llxprt-sentinel-partial'));
    const guard = new RealHomeSentinelGuard({
      targets: [targetFor(first), targetFor(second)],
      sessionId: 'partial',
    });

    expect(() => guard.captureBaseline()).toThrow();
    guard.cleanup();

    expect(readdirSync(first)).toEqual([]);
    expect(
      statSync(join(second, '.llxprt-sentinel-partial')).isDirectory(),
    ).toBe(true);
  });

  it('is safe before a baseline was captured', () => {
    const guard = new RealHomeSentinelGuard({
      targets: [targetFor(join(getHome(), '.llxprt'))],
      sessionId: 'session-a',
    });

    expect(() => guard.cleanup()).not.toThrow();
  });
});

describe('createRealHomeSentinelGuard factory', () => {
  const getHome = useFakeHome();

  it('produces a no-op guard when LLXPRT_TEST_SENTINEL_GUARD=0', () => {
    const legacyDir = join(getHome(), '.llxprt');
    mkdirSync(legacyDir);
    writeFileSync(join(legacyDir, 'settings.json'), '{}');
    const guard = createRealHomeSentinelGuard({
      [SENTINEL_GUARD_DISABLE_ENV]: '0',
      HOME: getHome(),
    });

    guard.captureBaseline();
    guard.assertUnchanged(LABEL);
    guard.cleanup();

    expect(readdirSync(legacyDir)).toEqual(['settings.json']);
  });

  it('guards the env home dirs through the real guard', () => {
    const legacyDir = join(getHome(), '.llxprt');
    const skillsDir = join(getHome(), '.agents', 'skills');
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });
    const guard = createRealHomeSentinelGuard({
      HOME: getHome(),
      LLXPRT_TEST_STORAGE_ISOLATED: '1',
    });
    try {
      guard.captureBaseline();

      const sentinels = (dir: string): string[] =>
        readdirSync(dir).filter((name) => name.startsWith('.llxprt-sentinel-'));
      expect(sentinels(legacyDir)).toHaveLength(1);
      expect(sentinels(skillsDir)).toHaveLength(1);
    } finally {
      guard.cleanup();
    }
  });
});

describe('resolveRealHomeSentinelTargets', () => {
  const getHome = useFakeHome();

  it('targets the env home legacy and skills dirs', () => {
    const targets = resolveRealHomeSentinelTargets({ HOME: getHome() });

    expect(targets.map((target) => target.path)).toContain(
      join(getHome(), '.llxprt'),
    );
    expect(targets.map((target) => target.path)).toContain(
      join(getHome(), '.agents', 'skills'),
    );
  });

  it('uses the injected isolation marker to omit platform storage targets', () => {
    const targets = resolveRealHomeSentinelTargets({
      HOME: getHome(),
      LLXPRT_TEST_STORAGE_ISOLATED: '1',
    });
    expect(targets.map((target) => target.path)).toEqual([
      join(getHome(), '.llxprt'),
      join(getHome(), '.agents', 'skills'),
    ]);
  });

  it('includes the resolved platform config dir when storage is not isolated', () => {
    const previousMarker = process.env.LLXPRT_TEST_STORAGE_ISOLATED;
    const previousConfigHome = process.env.LLXPRT_CONFIG_HOME;
    const configHome = join(getHome(), 'platform-config');
    delete process.env.LLXPRT_TEST_STORAGE_ISOLATED;
    process.env.LLXPRT_CONFIG_HOME = configHome;
    try {
      const targets = resolveRealHomeSentinelTargets({ HOME: getHome() });

      expect(targets.map((target) => target.path)).toContain(configHome);
    } finally {
      if (previousMarker === undefined) {
        delete process.env.LLXPRT_TEST_STORAGE_ISOLATED;
      } else {
        process.env.LLXPRT_TEST_STORAGE_ISOLATED = previousMarker;
      }
      if (previousConfigHome === undefined) {
        delete process.env.LLXPRT_CONFIG_HOME;
      } else {
        process.env.LLXPRT_CONFIG_HOME = previousConfigHome;
      }
    }
  });
});

it('continues removing later sentinels when one removal fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-cleanup-'));
  const targets = ['first', 'second'].map((name) => join(root, name));
  for (const target of targets) mkdirSync(target);
  const guard = new RealHomeSentinelGuard({
    targets: targets.map((path) => ({ path, description: path })),
    sessionId: 'cleanup',
  });
  const messages: unknown[] = [];
  const log = spyOn(console, 'error').mockImplementation((message: unknown) => {
    messages.push(message);
  });
  try {
    guard.captureBaseline();
    const blocked = join(targets[0]!, '.llxprt-sentinel-cleanup');
    rmSync(blocked);
    mkdirSync(blocked);
    expect(() => guard.cleanup()).not.toThrow();
    expect(readdirSync(targets[1]!)).toEqual([]);
    expect(messages.join()).toContain(blocked);
  } finally {
    log.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});

it('removes a partially written sentinel when writing the baseline fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-partial-write-'));
  const write = fs.writeFileSync;
  const guard = new RealHomeSentinelGuard({
    targets: [{ path: root, description: root }],
    sessionId: 'partial-write',
  });
  const failingWrite = spyOn(fs, 'writeFileSync').mockImplementation(
    (path, content, options) => {
      write(path, content, options);
      throw new Error('partial write failed');
    },
  );
  try {
    expect(() => guard.captureBaseline()).toThrow('partial write failed');
    expect(readdirSync(root)).toEqual([]);
  } finally {
    failingWrite.mockRestore();
    guard.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
