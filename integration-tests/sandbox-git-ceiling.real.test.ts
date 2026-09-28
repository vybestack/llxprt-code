/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addContainerEnvVars,
  buildContainerRunArgs,
} from '../packages/cli/src/utils/sandbox-containers.js';

const image = 'ghcr.io/vybestack/llxprt-code/sandbox:0.11.0';
const runtime = process.env.LLXPRT_SANDBOX;

function dockerReady(): boolean {
  if (runtime !== 'docker') return false;
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 20_000 });
    execFileSync('docker', ['image', 'inspect', image], {
      stdio: 'ignore',
      timeout: 20_000,
    });
    return true;
  } catch {
    return false;
  }
}

function gitRoot(dir: string, env: NodeJS.ProcessEnv): string {
  return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

describe('TestRig Git discovery boundary', () => {
  it('blocks discovery of the host checkout from a nested test directory', () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), 'llxprt-git-ceiling-')),
    );
    const ceiling = join(root, '.integration-tests');
    const testDir = join(ceiling, 'run', 'test');
    try {
      mkdirSync(testDir, { recursive: true });
      execFileSync('git', ['init', '-q', root]);
      const env = { ...process.env };
      delete env.GIT_CEILING_DIRECTORIES;
      expect(gitRoot(testDir, env)).toBe(root);
      expect(() =>
        gitRoot(testDir, { ...env, GIT_CEILING_DIRECTORIES: ceiling }),
      ).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!dockerReady())(
    'blocks discovery of a bind-mounted parent repo inside the real Docker sandbox',
    () => {
      const root = realpathSync(
        mkdtempSync(join(tmpdir(), 'llxprt-docker-git-ceiling-')),
      );
      const ceiling = join(root, '.integration-tests');
      const testDir = join(ceiling, 'run', 'test');
      const sessionDir = join(root, 'session');
      const originalCeiling = process.env.GIT_CEILING_DIRECTORIES;
      try {
        mkdirSync(testDir, { recursive: true });
        mkdirSync(sessionDir);
        execFileSync('git', ['init', '-q', root]);
        const config = { command: 'docker', image } as const;
        const containerArgs = buildContainerRunArgs(
          config,
          image,
          root,
          root,
          sessionDir,
        ).filter((arg) => arg !== '-t');
        containerArgs[containerArgs.indexOf('--workdir') + 1] = testDir;
        delete process.env.GIT_CEILING_DIRECTORIES;
        const baselineArgs = [...containerArgs];
        addContainerEnvVars(baselineArgs, config, 'git-ceiling-test', [], root);
        expect(
          execFileSync(
            'docker',
            [
              ...baselineArgs,
              '--entrypoint',
              'sh',
              image,
              '-c',
              'git rev-parse --show-toplevel',
            ],
            { encoding: 'utf8', timeout: 30_000 },
          ).trim(),
        ).toBe(root);
        process.env.GIT_CEILING_DIRECTORIES = ceiling;
        addContainerEnvVars(
          containerArgs,
          config,
          'git-ceiling-test',
          [],
          root,
        );
        const args = [
          ...containerArgs,
          '--entrypoint',
          'sh',
          image,
          '-c',
          'git rev-parse --show-toplevel',
        ];
        expect(() =>
          execFileSync('docker', args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 30_000,
          }),
        ).toThrow();
      } finally {
        if (originalCeiling === undefined) {
          delete process.env.GIT_CEILING_DIRECTORIES;
        } else {
          process.env.GIT_CEILING_DIRECTORIES = originalCeiling;
        }
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
