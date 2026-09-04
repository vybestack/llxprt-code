#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for persistent sandbox checkpoint storage (#3464).
 *
 * The fake container engine (test-utils/fake-dependency-engine.ts) executes
 * the production engine argv for real: volumes exist as directories, and
 * the init script genuinely runs through sh against them. The entrypoint
 * stanza is executed through real bash. Every assertion observes engine
 * state, filesystem state, or produced argv/script text; no production
 * module is mocked.
 */

import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SandboxConfig } from '@vybestack/llxprt-code-core';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { useFakeEngine } from '../../test-utils/fake-dependency-engine-harness.js';
import {
  planCheckpointStorage,
  attachPersistentCheckpointStore,
  buildCheckpointEntrypointScript,
  CHECKPOINT_VOLUME_NAME_PREFIX,
  CHECKPOINT_STORE_MOUNT_PATH,
  SANDBOX_CHECKPOINT_STORE_LABEL,
  SANDBOX_CHECKPOINT_PERSISTENT_LABEL,
  SANDBOX_CHECKPOINT_PROJECT_KEY_ENV,
  SANDBOX_CHECKPOINT_STORE_ENV,
} from './sandbox-checkpoint-storage.js';
import {
  buildContainerRunArgs,
  validateContainerSandboxEnv,
} from './sandbox-containers.js';
import { entrypoint } from './sandbox-entrypoint.js';
import { getContainerPath } from './sandbox-env.js';
import { addPrivateDependencyMounts } from './sandbox-node-modules.js';
import {
  DEPENDENCY_VOLUME_NAME_PREFIX,
  SANDBOX_DEPENDENCY_RUN_LABEL,
} from './sandbox-dependency-volumes.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function makeWorkspace(): string {
  return fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'issue3464-ws-'),
  );
}

/** The value following a flag token, when the flag is present. */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

describe('persistent sandbox checkpoint storage (#3464)', () => {
  const harness = useFakeEngine('docker');
  const config = harness.config as SandboxConfig;
  const podmanConfig = harness.podmanConfig as SandboxConfig;

  /** The volume directory the fake engine backs a named volume with. */
  function fakeVolumeDir(name: string): string {
    return path.join(harness.stateRoot, 'volumes', name);
  }

  function checkpointVolumeCreateCount(): number {
    return harness
      .invocations()
      .filter((argv) => argv[0] === 'volume' && argv[1] === 'create')
      .filter((argv) => {
        const name = argv[argv.length - 1];
        return (
          typeof name === 'string' &&
          name.startsWith(CHECKPOINT_VOLUME_NAME_PREFIX)
        );
      }).length;
  }

  describe('planCheckpointStorage (#3464)', () => {
    it('is disabled when checkpointing is off', () => {
      const plan = planCheckpointStorage(config, '/ws', false);
      expect(plan.enabled).toBe(false);
    });

    it('is disabled for the seatbelt engine path', () => {
      const seatbelt = { command: 'sandbox-exec', image: 'unused' };
      const plan = planCheckpointStorage(
        seatbelt as unknown as SandboxConfig,
        '/ws',
        true,
      );
      expect(plan.enabled).toBe(false);
    });

    it('derives the project key exactly as the in-container history dir does', () => {
      const workdir = makeWorkspace();
      // The container project root is the POSIX-converted workdir on
      // Windows (parity bind), so the key hashes that form.
      const projectKey = sha256(getContainerPath(workdir));
      for (const engineConfig of [config, podmanConfig]) {
        const plan = planCheckpointStorage(engineConfig, workdir, true);
        expect(plan.enabled).toBe(true);
        // Independent re-derivation: the shadow repository lives at
        // LLXPRT_DATA_HOME/history/<sha256(project root)>.
        expect(plan.projectKey).toBe(projectKey);
        expect(plan.volumeName).toBe(
          `${CHECKPOINT_VOLUME_NAME_PREFIX}${projectKey}`,
        );
      }
    });
  });

  describe('attachPersistentCheckpointStore (#3464)', () => {
    it('creates a distinctly labeled engine volume and never the per-run labels', () => {
      const workdir = makeWorkspace();
      const plan = planCheckpointStorage(config, workdir, true);
      const args: string[] = [];

      attachPersistentCheckpointStore(config, args, plan);

      expect(harness.volumeNames()).toContain(plan.volumeName);
      const labels = harness.snapshot().volumes[plan.volumeName].labels;
      expect(labels['com.vybestack.llxprt.sandbox-managed']).toBe('true');
      expect(labels[SANDBOX_CHECKPOINT_STORE_LABEL]).toBe(plan.projectKey);
      expect(labels[SANDBOX_CHECKPOINT_PERSISTENT_LABEL]).toBe('true');
      expect(labels[SANDBOX_DEPENDENCY_RUN_LABEL]).toBeUndefined();
      expect(labels['com.vybestack.llxprt.sandbox-owner']).toBeUndefined();
      expect(plan.volumeName.startsWith(DEPENDENCY_VOLUME_NAME_PREFIX)).toBe(
        false,
      );
    });

    it('runs a hardened uid-0 init that materializes the store layout and marker', () => {
      const workdir = makeWorkspace();
      const plan = planCheckpointStorage(config, workdir, true);
      const args: string[] = [];

      attachPersistentCheckpointStore(config, args, plan);

      // Identified by the init script's $0 marker, then every hardening
      // flag is asserted on that one invocation.
      const initInvocation = harness
        .invocations()
        .find(
          (argv) =>
            argv[0] === 'run' && argv.includes('llxprt-checkpoint-init'),
        );
      expect(initInvocation).toBeDefined();
      if (initInvocation === undefined) {
        throw new Error('checkpoint init invocation was not recorded');
      }
      expect(flagValue(initInvocation, '--user')).toBe('0:0');
      expect(flagValue(initInvocation, '--network')).toBe('none');
      expect(initInvocation.includes('--pull=never')).toBe(true);
      expect(initInvocation.includes('--cap-drop=ALL')).toBe(true);
      // The single capability carve-out: normalization chmods store entries
      // the previous session's uid created.
      expect(initInvocation.includes('--cap-add=FOWNER')).toBe(true);
      expect(initInvocation.includes('no-new-privileges')).toBe(true);

      const storeDir = fakeVolumeDir(plan.volumeName);
      const historyDir = path.join(storeDir, 'history', plan.projectKey);
      expect(
        fs.existsSync(path.join(historyDir, '.llxprt-checkpoint-store')),
      ).toBe(true);
      expect(fs.existsSync(path.join(storeDir, 'checkpoints'))).toBe(true);
      // World-writable WITHOUT the sticky bit: a later sandbox run under a
      // different selected uid must be able to rename git lockfiles over
      // entries this run created (index, refs, COMMIT_EDITMSG); the sticky
      // bit denies exactly that rename. Cross-uid behavior is proven against
      // real engines by integration-tests/sandboxCheckpointPersistence.
      const storeMode = fs.statSync(storeDir).mode & 0o7777;
      const historyMode = fs.statSync(historyDir).mode & 0o7777;
      expect(storeMode.toString(8)).toBe('777');
      expect(historyMode.toString(8)).toBe('777');
    });

    it('mounts the store at the neutral path and pins both env keys on the main container', () => {
      const workdir = makeWorkspace();
      const plan = planCheckpointStorage(config, workdir, true);
      const sessionTmpdir = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), 'issue3464-tmp-'),
      );
      const args = buildContainerRunArgs(
        config,
        harness.config.image,
        workdir,
        workdir,
        sessionTmpdir,
      );

      attachPersistentCheckpointStore(config, args, plan);

      expect(args).toContain('--mount');
      expect(
        args.includes(
          `type=volume,src=${plan.volumeName},dst=${CHECKPOINT_STORE_MOUNT_PATH}`,
        ),
      ).toBe(true);
      expect(
        args.includes(`--env`) &&
          args.includes(
            `${SANDBOX_CHECKPOINT_PROJECT_KEY_ENV}=${plan.projectKey}`,
          ),
      ).toBe(true);
      expect(
        args.includes(
          `${SANDBOX_CHECKPOINT_STORE_ENV}=${CHECKPOINT_STORE_MOUNT_PATH}`,
        ),
      ).toBe(true);
      expect(args.includes(`${SANDBOX_CHECKPOINT_PERSISTENT_LABEL}=true`)).toBe(
        true,
      );
    });

    it('reuses the existing store volume across runs instead of recreating it', () => {
      const workdir = makeWorkspace();
      const plan = planCheckpointStorage(config, workdir, true);

      attachPersistentCheckpointStore(config, [], plan);
      const probePath = path.join(
        fakeVolumeDir(plan.volumeName),
        'history',
        plan.projectKey,
        'run-one-probe.txt',
      );
      fs.writeFileSync(probePath, 'persisted across runs');

      attachPersistentCheckpointStore(config, [], plan);

      expect(checkpointVolumeCreateCount()).toBe(1);
      expect(fs.readFileSync(probePath, 'utf8')).toBe('persisted across runs');
    });

    it('fails before launch when the volume cannot be created, and never deletes anything', () => {
      const workdir = makeWorkspace();
      const plan = planCheckpointStorage(config, workdir, true);
      harness.setKnob('fail-volume-create-on', '1');
      const args: string[] = [];

      let caught: unknown;
      try {
        attachPersistentCheckpointStore(config, args, plan);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(FatalSandboxError);
      expect(String(caught)).toContain(plan.volumeName);
      expect(String(caught)).toContain('unavailable');

      expect(harness.volumeNames()).not.toContain(plan.volumeName);
      expect(
        harness
          .invocations()
          .some((argv) => argv[0] === 'volume' && argv[1] === 'rm'),
      ).toBe(false);
      expect(
        args.some(
          (token) =>
            typeof token === 'string' &&
            token.includes(CHECKPOINT_STORE_MOUNT_PATH),
        ),
      ).toBe(false);
    });

    it('fails before launch when the init run fails, and keeps the volume intact', () => {
      const workdir = makeWorkspace();
      const plan = planCheckpointStorage(config, workdir, true);
      harness.setKnob('fail-run-once');

      expect(() => attachPersistentCheckpointStore(config, [], plan)).toThrow(
        FatalSandboxError,
      );

      expect(harness.volumeNames()).toContain(plan.volumeName);
      expect(
        harness
          .invocations()
          .some((argv) => argv[0] === 'volume' && argv[1] === 'rm'),
      ).toBe(false);
    });

    it('does no engine work at all when the plan is disabled', () => {
      const plan = planCheckpointStorage(config, makeWorkspace(), false);
      attachPersistentCheckpointStore(config, [], plan);
      expect(harness.invocations()).toHaveLength(0);
    });
  });

  describe('reserved checkpoint env keys (#3464)', () => {
    it('rejects SANDBOX_ENV overrides for both pinned keys', () => {
      const saved = process.env.SANDBOX_ENV;
      try {
        // Matching the key named in the rejection proves the right reservation
        // fired, not merely that some validation failed.
        process.env.SANDBOX_ENV = `${SANDBOX_CHECKPOINT_PROJECT_KEY_ENV}=evil`;
        expect(() => validateContainerSandboxEnv()).toThrow(
          new RegExp(`reserved key '${SANDBOX_CHECKPOINT_PROJECT_KEY_ENV}'`),
        );

        process.env.SANDBOX_ENV = `${SANDBOX_CHECKPOINT_STORE_ENV}=/evil`;
        expect(() => validateContainerSandboxEnv()).toThrow(
          new RegExp(`reserved key '${SANDBOX_CHECKPOINT_STORE_ENV}'`),
        );
      } finally {
        if (saved === undefined) {
          delete process.env.SANDBOX_ENV;
        } else {
          process.env.SANDBOX_ENV = saved;
        }
      }
    });
  });

  describe('checkpoint entrypoint stanza (#3464)', () => {
    interface Layout {
      readonly root: string;
      readonly store: string;
      readonly dataHome: string;
      readonly logHome: string;
      readonly projectKey: string;
    }

    function buildLayout(): Layout {
      const root = fs.mkdtempSync(
        path.join(fs.realpathSync(os.tmpdir()), 'issue3464-stanza-'),
      );
      const projectKey = sha256(root);
      const store = path.join(root, 'store');
      const dataHome = path.join(
        root,
        'home',
        '.local',
        'share',
        'llxprt-code',
      );
      const logHome = path.join(root, 'home', '.local', 'state', 'llxprt-code');
      fs.mkdirSync(path.join(store, 'history', projectKey), {
        recursive: true,
      });
      fs.mkdirSync(path.join(store, 'checkpoints'), { recursive: true });
      fs.writeFileSync(
        path.join(store, 'history', projectKey, '.llxprt-checkpoint-store'),
        'llxprt-code persistent checkpoint store',
      );
      return { root, store, dataHome, logHome, projectKey };
    }

    function runStanza(layout: Layout): ReturnType<typeof spawnSync> {
      return spawnSync(
        'bash',
        ['--noprofile', '--norc', '-c', buildCheckpointEntrypointScript()],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            [SANDBOX_CHECKPOINT_PROJECT_KEY_ENV]: layout.projectKey,
            [SANDBOX_CHECKPOINT_STORE_ENV]: layout.store,
            LLXPRT_DATA_HOME: layout.dataHome,
            LLXPRT_LOG_HOME: layout.logHome,
          },
        },
      );
    }

    it('links history and checkpoints into the persistent store, so writes survive the container', () => {
      const layout = buildLayout();
      const result = runStanza(layout);
      expect(result.status).toBe(0);

      const historyLink = path.join(layout.dataHome, 'history');
      const checkpointsLink = path.join(
        layout.logHome,
        'tmp',
        layout.projectKey,
        'checkpoints',
      );
      expect(fs.lstatSync(historyLink).isSymbolicLink()).toBe(true);
      expect(fs.lstatSync(checkpointsLink).isSymbolicLink()).toBe(true);

      // The observable persistence contract: in-container checkpoint writes
      // land inside the engine-owned store.
      fs.writeFileSync(
        path.join(historyLink, layout.projectKey, 'shadow-probe.txt'),
        'from the container',
      );
      fs.writeFileSync(
        path.join(checkpointsLink, 'checkpoint-1.json'),
        '{"commitHash":"abc"}',
      );
      expect(
        fs.readFileSync(
          path.join(
            layout.store,
            'history',
            layout.projectKey,
            'shadow-probe.txt',
          ),
          'utf8',
        ),
      ).toBe('from the container');
      expect(
        fs.readFileSync(
          path.join(layout.store, 'checkpoints', 'checkpoint-1.json'),
          'utf8',
        ),
      ).toBe('{"commitHash":"abc"}');
    });

    it('is idempotent across repeated launches', () => {
      const layout = buildLayout();
      expect(runStanza(layout).status).toBe(0);
      const second = runStanza(layout);
      expect(second.status).toBe(0);
      expect(fs.realpathSync(path.join(layout.dataHome, 'history'))).toBe(
        fs.realpathSync(path.join(layout.store, 'history')),
      );
      fs.writeFileSync(
        path.join(
          layout.dataHome,
          'history',
          layout.projectKey,
          'idempotence-probe.txt',
        ),
        'idempotence probe',
      );
      expect(
        fs.readFileSync(
          path.join(
            layout.store,
            'history',
            layout.projectKey,
            'idempotence-probe.txt',
          ),
          'utf8',
        ),
      ).toBe('idempotence probe');
    });

    it.skipIf(process.platform === 'win32')(
      'keeps the history link itself a symlink to the store on POSIX',
      () => {
        // Git-bash's second `ln -sfn` can leave a non-symlink on Windows
        // (the stanza itself targets container Linux), so the strict
        // link-type assertion only runs where native symlinks are guaranteed;
        // every platform asserts the persistence contract instead.
        const layout = buildLayout();
        expect(runStanza(layout).status).toBe(0);
        expect(runStanza(layout).status).toBe(0);
        expect(fs.readlinkSync(path.join(layout.dataHome, 'history'))).toBe(
          path.join(layout.store, 'history'),
        );
      },
    );

    it('aborts the sandbox before the CLI runs when the store is not mounted', () => {
      const layout = buildLayout();
      fs.rmSync(
        path.join(
          layout.store,
          'history',
          layout.projectKey,
          '.llxprt-checkpoint-store',
        ),
      );
      const result = runStanza(layout);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('persistent checkpoint store');
      expect(fs.existsSync(path.join(layout.dataHome, 'history'))).toBe(false);
    });
  });

  describe('entrypoint composition (#3464)', () => {
    it('runs the stanza after the XDG home pin when provided, and omits it otherwise', () => {
      const workdir = makeWorkspace();
      const stanza = buildCheckpointEntrypointScript();
      const withStore = entrypoint(
        workdir,
        ['node', 'cli', 'run'],
        undefined,
        undefined,
        stanza,
      );
      const script = withStore[withStore.length - 1];
      expect(typeof script).toBe('string');
      const pinIndex = script.indexOf('export LLXPRT_DATA_HOME');
      const stanzaIndex = script.indexOf('LLXPRT_SANDBOX_CHECKPOINT_STORE');
      expect(pinIndex).toBeGreaterThanOrEqual(0);
      expect(stanzaIndex).toBeGreaterThan(pinIndex);

      const withoutStore = entrypoint(workdir, ['node', 'cli', 'run']);
      const plain = withoutStore[withoutStore.length - 1];
      expect(plain.includes('LLXPRT_SANDBOX_CHECKPOINT_STORE')).toBe(false);
    });
  });

  describe('coexistence with #3450 dependency volumes', () => {
    it('dependency lifecycle release keeps the checkpoint store and its history', () => {
      const workdir = makeWorkspace();
      fs.mkdirSync(path.join(workdir, 'node_modules'), { recursive: true });
      const depPlan = {
        enabled: true,
        workspaceRoots: [workdir],
        destinations: [path.join(workdir, 'node_modules')],
        originallyAbsentDestinations: [],
      } as const;
      const args: string[] = [];
      const lifecycle = addPrivateDependencyMounts(
        config,
        args,
        workdir,
        depPlan,
      );

      const checkpointPlan = planCheckpointStorage(config, workdir, true);
      attachPersistentCheckpointStore(config, args, checkpointPlan);

      lifecycle.release();

      const volumes = harness.volumeNames();
      expect(volumes).toContain(checkpointPlan.volumeName);
      for (const name of volumes) {
        if (name === checkpointPlan.volumeName) continue;
        expect(name.startsWith(DEPENDENCY_VOLUME_NAME_PREFIX)).toBe(false);
      }
      expect(
        fs.existsSync(
          path.join(
            fakeVolumeDir(checkpointPlan.volumeName),
            'history',
            checkpointPlan.projectKey,
            '.llxprt-checkpoint-store',
          ),
        ),
      ).toBe(true);
    });
  });
});
