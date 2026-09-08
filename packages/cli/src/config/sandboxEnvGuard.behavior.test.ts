/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as fs from 'fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './environmentLoader.js';
import {
  loadEnvironment as loadEnvironmentFromSettings,
  type Settings,
} from './settings.js';
import {
  addContainerEnvVars,
  addContainerVolumeMounts,
  buildContainerRunArgs,
} from '../utils/sandbox-containers.js';
import { isUserGlobalEnvFile } from './sandboxEnvGuard.js';

void vi.mock('command-exists', () => ({
  default: {
    sync: vi.fn(
      (command: string) => command === 'docker' || command === 'podman',
    ),
  },
}));

const { loadSandboxConfig } = await import('./sandboxConfig.js');

describe('sandbox-env-guard', () => {
  const CONFIG = { command: 'docker', image: 'test' } as const;
  const SENTINEL = 'sentinel-2958-ambient-key';
  const NEWLINE = String.fromCharCode(10);
  const AMBIENT_API_KEY_VAR = 'GEMINI_API_KEY';

  /**
   * The launcher controls a repository `.env` must never be able to set. Written
   * out independently of the production set so the suite states the security
   * requirement rather than mirroring the implementation.
   */
  const LAUNCHER_ENV_VARS = [
    'SANDBOX_FLAGS',
    'SANDBOX_ENV',
    'LLXPRT_SANDBOX_MOUNTS',
    'SANDBOX_MOUNTS',
    'LLXPRT_SANDBOX',
    'SANDBOX',
    'LLXPRT_SANDBOX_IMAGE',
    'BUILD_SANDBOX',
    'SEATBELT_PROFILE',
    'LLXPRT_SANDBOX_NETWORK',
    'SANDBOX_NETWORK',
    'LLXPRT_SANDBOX_PROXY_COMMAND',
    'LLXPRT_SANDBOX_CPUS',
    'SANDBOX_CPUS',
    'LLXPRT_SANDBOX_MEMORY',
    'SANDBOX_MEMORY',
    'LLXPRT_SANDBOX_PIDS',
    'SANDBOX_PIDS',
    'SANDBOX_PORTS',
    'LLXPRT_SANDBOX_SSH_AGENT',
    'SANDBOX_SSH_AGENT',
    'SANDBOX_SET_UID_GID',
    'LLXPRT_CONFIG_HOME',
    'LLXPRT_DATA_HOME',
    'LLXPRT_CACHE_HOME',
    'LLXPRT_LOG_HOME',
  ] as const;

  /**
   * The storage roots double as the test harness's isolation mechanism: the
   * repo-root preload points them at a per-process temp directory so nothing
   * touches the developer's real config. The per-test reset must leave them
   * alone, or every case in this file would resolve Storage against the real
   * user directories. Individual tests still clear one deliberately.
   */
  const STORAGE_ROOT_ENV_VARS = new Set<string>([
    'LLXPRT_CONFIG_HOME',
    'LLXPRT_DATA_HOME',
    'LLXPRT_CACHE_HOME',
    'LLXPRT_LOG_HOME',
  ]);

  let originalCwd = '';
  let originalEnv: NodeJS.ProcessEnv;
  let tempDirs: string[] = [];

  function makeTempDir(prefix: string): string {
    const dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), `issue-2958-${prefix}`)),
    );
    tempDirs.push(dir);
    return dir;
  }

  function useRepoSandboxHarness(): void {
    beforeEach(() => {
      originalCwd = process.cwd();
      originalEnv = { ...process.env };
      tempDirs = [];
      for (const key of LAUNCHER_ENV_VARS) {
        if (!STORAGE_ROOT_ENV_VARS.has(key)) delete process.env[key];
      }
      delete process.env.GEMINI_API_KEY;
      delete process.env.MY_PROJECT_VAR;
      process.chdir(makeTempDir('repo-'));
    });

    afterEach(() => {
      process.chdir(originalCwd);
      for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      for (const key of Object.keys(process.env)) {
        delete process.env[key];
      }
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value !== undefined) process.env[key] = value;
      }
    });
  }

  function writeDotEnv(relativePath: string, content: string): void {
    const absolutePath = path.join(process.cwd(), relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }

  function runArgs(): string[] {
    return buildContainerRunArgs(
      CONFIG,
      'sandbox:0.11.0',
      process.cwd(),
      '/workspace',
      process.cwd(),
    );
  }

  interface StartupProbeResult {
    readonly env: Record<string, string | null>;
    readonly sentinelInArgs: boolean;
  }

  /**
   * Runs the real startup order — the settings loader, then the loader
   * `loadCliConfig` calls — in a child process whose storage roots are UNSET,
   * which is the normal production state and the state the config-root poisoning
   * bypass needs. It cannot be reproduced in-process: the suite's isolation
   * preload sets those roots, and clearing them there would drop the test onto
   * the developer's real configuration. The child is isolated instead by pointing
   * HOME at a temp directory before it starts, so every platform default it
   * computes lands under that directory.
   */
  function runRealStartupSequence(repoDir: string): StartupProbeResult {
    const configDir = path.dirname(fileURLToPath(import.meta.url));
    const importPath = (relative: string): string =>
      JSON.stringify(path.join(configDir, relative));
    const probePath = path.join(repoDir, 'startup-probe.ts');
    fs.writeFileSync(
      probePath,
      [
        `import { loadEnvironment as loadFromSettings } from ${importPath('settings.js')};`,
        `import { loadEnvironment as loadFromEnvLoader } from ${importPath('environmentLoader.js')};`,
        `import { buildContainerRunArgs } from ${importPath('../utils/sandbox-containers.js')};`,
        `loadFromSettings({});`,
        `loadFromEnvLoader();`,
        `const args = buildContainerRunArgs({ command: 'docker', image: 'test' }, 'sandbox:0.11.0', process.cwd(), '/workspace', process.cwd());`,
        `const reported = ${JSON.stringify(LAUNCHER_ENV_VARS)};`,
        `const env = Object.fromEntries(reported.map((k) => [k, process.env[k] ?? null]));`,
        `console.log(JSON.stringify({`,
        `  env,`,
        `  sentinelInArgs: args.join(' ').includes(${JSON.stringify(SENTINEL)}),`,
        `}));`,
      ].join(NEWLINE),
    );

    const result = spawnSync(process.execPath, [probePath], {
      cwd: repoDir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: makeTempDir('home-'),
        // Computed key: a literal Gemini-prefixed object property would trip the
        // provider-agnostic naming guard in packages/agents.
        [AMBIENT_API_KEY_VAR]: SENTINEL,
      },
    });
    if (result.status !== 0) {
      throw new Error(`startup probe failed: ${result.stderr}`);
    }
    return JSON.parse(result.stdout.trim()) as StartupProbeResult;
  }

  describe('sandboxEnvGuard', () => {
    describe('a repo .env cannot set sandbox launcher variables', () => {
      useRepoSandboxHarness();

      it('T1 (AC1, AC4): SANDBOX_FLAGS from a repo .env never carries the ambient API key into the run args', () => {
        process.env.GEMINI_API_KEY = SENTINEL;
        writeDotEnv(
          '.env',
          'SANDBOX_FLAGS=--env GEMINI_API_KEY=$GEMINI_API_KEY',
        );

        loadEnvironment();

        expect(process.env.SANDBOX_FLAGS).toBeUndefined();
        expect(runArgs().join(' ')).not.toContain(SENTINEL);
      });

      it('T2 (AC2): SANDBOX_ENV from a repo .env cannot inject the ambient API key into the container env args', () => {
        process.env.GEMINI_API_KEY = SENTINEL;
        writeDotEnv('.env', 'SANDBOX_ENV=STOLEN=$GEMINI_API_KEY');

        loadEnvironment();

        const args: string[] = [];
        addContainerEnvVars(args, CONFIG, 'test-container', [], '/workspace');
        expect(args.join(' ')).not.toContain(SENTINEL);
      });

      it('T3 (AC2): mount variables from a repo .env add no --volume even though the path really exists', () => {
        const mountDir = path.join(process.cwd(), 'real-mount-dir');
        fs.mkdirSync(mountDir);
        writeDotEnv(
          '.env',
          `LLXPRT_SANDBOX_MOUNTS=${mountDir}\nSANDBOX_MOUNTS=${mountDir}\n`,
        );

        loadEnvironment();

        const args: string[] = [];
        addContainerVolumeMounts(args);
        expect(args.join(' ')).not.toContain('real-mount-dir');
      });

      it('T4: a repo .llxprt/.env is repo-controlled too and cannot set SANDBOX_FLAGS', () => {
        process.env.GEMINI_API_KEY = SENTINEL;
        writeDotEnv(
          '.llxprt/.env',
          'SANDBOX_FLAGS=--env GEMINI_API_KEY=$GEMINI_API_KEY',
        );

        loadEnvironment();

        expect(process.env.SANDBOX_FLAGS).toBeUndefined();
        expect(runArgs().join(' ')).not.toContain(SENTINEL);
      });

      it('T10: a repo .env cannot re-point the config root at itself to smuggle SANDBOX_FLAGS through the second loader', () => {
        writeDotEnv(
          '.env',
          `LLXPRT_CONFIG_HOME=${process.cwd()}\nSANDBOX_FLAGS=--env STOLEN=$GEMINI_API_KEY\n`,
        );

        const result = runRealStartupSequence(process.cwd());

        expect(result.env.LLXPRT_CONFIG_HOME).toBeNull();
        expect(result.env.SANDBOX_FLAGS).toBeNull();
        expect(result.sentinelInArgs).toBe(false);
      });

      it('T13: SANDBOX_FLAGS the Bun runtime pre-loads from a repo .env never reaches the run args', () => {
        writeDotEnv(
          '.env',
          'SANDBOX_FLAGS=--env GEMINI_API_KEY=$GEMINI_API_KEY',
        );

        const result = runRealStartupSequence(process.cwd());

        expect(result.env.SANDBOX_FLAGS).toBeNull();
        expect(result.sentinelInArgs).toBe(false);
      });

      it('T14: a launcher control named only in a repo .env.local is dropped too', () => {
        writeDotEnv('.env', 'MY_PROJECT_VAR=hello-2958');
        writeDotEnv('.env.local', 'SANDBOX_FLAGS=--env STOLEN=$GEMINI_API_KEY');

        const result = runRealStartupSequence(process.cwd());

        expect(result.env.SANDBOX_FLAGS).toBeNull();
        expect(result.sentinelInArgs).toBe(false);
      });

      it('T17: a launcher control in a repo .env.development is dropped, because Bun defaults the mode when NODE_ENV is unset', () => {
        writeDotEnv(
          '.env.development',
          'SANDBOX_FLAGS=--env STOLEN=$GEMINI_API_KEY',
        );

        const result = runRealStartupSequence(process.cwd());

        expect(result.env.SANDBOX_FLAGS).toBeNull();
        expect(result.sentinelInArgs).toBe(false);
      });

      it('T18: a launcher control in a repo .env.development.local is dropped too', () => {
        writeDotEnv(
          '.env.development.local',
          'SANDBOX_FLAGS=--env STOLEN=$GEMINI_API_KEY',
        );

        const result = runRealStartupSequence(process.cwd());

        expect(result.env.SANDBOX_FLAGS).toBeNull();
        expect(result.sentinelInArgs).toBe(false);
      });

      it('T15: a repo .llxprt/.env does not shadow the runtime scrub of the sibling .env', () => {
        writeDotEnv('.llxprt/.env', 'MY_PROJECT_VAR=hello-2958');
        writeDotEnv('.env', 'SANDBOX_FLAGS=--env STOLEN=$GEMINI_API_KEY');

        const result = runRealStartupSequence(process.cwd());

        expect(result.env.SANDBOX_FLAGS).toBeNull();
        expect(result.sentinelInArgs).toBe(false);
      });

      it('T16: a repo .env cannot set any of the storage roots that select the config bind mount', () => {
        writeDotEnv(
          '.env',
          [...STORAGE_ROOT_ENV_VARS]
            .map((rootVar) => `${rootVar}=${process.cwd()}`)
            .join(NEWLINE),
        );

        const result = runRealStartupSequence(process.cwd());

        for (const rootVar of STORAGE_ROOT_ENV_VARS) {
          expect(result.env[rootVar]).toBeNull();
        }
      });

      it('T11: a lower-cased launcher key in a repo .env is blocked (Windows env names are case-insensitive)', () => {
        writeDotEnv('.env', 'sandbox_flags=--cap-add=NET_ADMIN');

        loadEnvironment();

        expect(process.env.SANDBOX_FLAGS).toBeUndefined();
        expect(process.env['sandbox_flags']).toBeUndefined();
      });

      for (const launcherVar of LAUNCHER_ENV_VARS) {
        if (STORAGE_ROOT_ENV_VARS.has(launcherVar)) continue;
        it(`blocks ${launcherVar} set by a repo .env`, () => {
          writeDotEnv('.env', `${launcherVar}=repo-supplied-value`);

          loadEnvironment();

          expect(process.env[launcherVar]).toBeUndefined();
        });
      }

      it('T9 (AC5): excludedProjectEnvVars: [] does not switch the guard off', () => {
        writeDotEnv('.env', 'SANDBOX_FLAGS=--cap-add=NET_ADMIN');
        const settings: Settings = { excludedProjectEnvVars: [] };

        loadEnvironmentFromSettings(settings);

        expect(process.env.SANDBOX_FLAGS).toBeUndefined();
      });

      it('T7: a repo .env key that is not a launcher control still loads', () => {
        writeDotEnv('.env', 'MY_PROJECT_VAR=hello-2958');

        loadEnvironment();

        expect(process.env.MY_PROJECT_VAR).toBe('hello-2958');
      });
    });

    describe('user-supplied sandbox launcher variables keep working', () => {
      useRepoSandboxHarness();

      it('T5 (AC3): a shell-exported SANDBOX_FLAGS survives and reaches the run args', () => {
        process.env.SANDBOX_FLAGS = '--cap-add=NET_ADMIN';
        writeDotEnv('.env', 'MY_PROJECT_VAR=hello-2958');

        loadEnvironment();

        expect(process.env.SANDBOX_FLAGS).toBe('--cap-add=NET_ADMIN');
        expect(runArgs().join(' ')).toContain('--cap-add=NET_ADMIN');
      });

      it('T5b: a repo .env that names SANDBOX_FLAGS drops the control entirely rather than letting the repo pick the value', () => {
        process.env.SANDBOX_FLAGS = '--cap-add=NET_ADMIN';
        writeDotEnv(
          '.env',
          'SANDBOX_FLAGS=--env GEMINI_API_KEY=$GEMINI_API_KEY',
        );

        loadEnvironment();

        expect(process.env.SANDBOX_FLAGS).toBeUndefined();
        expect(runArgs().join(' ')).not.toContain('GEMINI_API_KEY');
      });

      it('T12 (AC3): a sandbox profile still supplies SANDBOX_FLAGS and mounts after a hostile repo .env', async () => {
        const globalConfigDir = makeTempDir('global-');
        const mountDir = makeTempDir('mount-');
        process.env.LLXPRT_CONFIG_HOME = globalConfigDir;
        fs.mkdirSync(path.join(globalConfigDir, 'sandboxes'), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(globalConfigDir, 'sandboxes', 'issue2958.json'),
          JSON.stringify({
            engine: 'docker',
            image: 'sandbox:0.11.0',
            resources: { cpus: 2 },
            mounts: [{ from: mountDir, to: '/mnt/profile', mode: 'ro' }],
            env: { SANDBOX_FLAGS: '--cap-add=NET_ADMIN' },
          }),
        );
        writeDotEnv(
          '.env',
          'SANDBOX_FLAGS=--env GEMINI_API_KEY=$GEMINI_API_KEY',
        );

        loadEnvironment();
        await loadSandboxConfig(
          { sandbox: true },
          { sandboxProfileLoad: 'issue2958', sandboxEngine: 'docker' },
        );

        const args = runArgs();
        addContainerVolumeMounts(args);
        const joined = args.join(' ');
        expect(joined).toContain('--cap-add=NET_ADMIN');
        expect(joined).toContain('/mnt/profile');
        expect(joined).not.toContain('GEMINI_API_KEY');
      });

      it('T8: an env file at the global config root may still set SANDBOX_FLAGS', () => {
        const globalConfigDir = makeTempDir('global-');
        process.env.LLXPRT_CONFIG_HOME = globalConfigDir;
        fs.writeFileSync(
          path.join(globalConfigDir, '.env'),
          'SANDBOX_FLAGS=--cap-add=NET_ADMIN',
        );

        loadEnvironment();

        expect(process.env.SANDBOX_FLAGS).toBe('--cap-add=NET_ADMIN');
        expect(runArgs().join(' ')).toContain('--cap-add=NET_ADMIN');
      });
    });

    describe('isUserGlobalEnvFile', () => {
      useRepoSandboxHarness();

      it('trusts the env file at the global config root but not a sibling directory', () => {
        const globalConfigDir = path.join(process.cwd(), 'config-root');
        process.env.LLXPRT_CONFIG_HOME = globalConfigDir;

        expect(isUserGlobalEnvFile(path.join(globalConfigDir, '.env'))).toBe(
          true,
        );
        expect(
          isUserGlobalEnvFile(path.join(`${globalConfigDir}-evil`, '.env')),
        ).toBe(false);
      });

      it('does not trust a repository checked out underneath the global config root', () => {
        const globalConfigDir = path.join(process.cwd(), 'config-root');
        process.env.LLXPRT_CONFIG_HOME = globalConfigDir;

        expect(
          isUserGlobalEnvFile(path.join(globalConfigDir, 'some-repo', '.env')),
        ).toBe(false);
      });

      it('trusts the env file at the home root', () => {
        expect(isUserGlobalEnvFile(path.join(os.homedir(), '.env'))).toBe(true);
      });
    });
  });
});
