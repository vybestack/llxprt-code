/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test-side harness for fake-dependency-engine.ts (#3450).
 *
 * Also used by the #3469 launch-lifecycle tests: the fake engine's network
 * records and sidecar-aware run parsing keep the proxy-sidecar launch path
 * observable through the same persistent state files.
 *
 * `useFakeEngine()` wires the suite lifecycle: it installs the fake engine
 * executable on PATH under the names `docker` and `podman` (so production
 * `spawnSync(config.command, ...)` calls reach it), points
 * FAKE_ENGINE_STATE at an isolated per-suite root, and resets that state
 * before every test. Tests then observe the fake engine's persistent state
 * files; nothing about the production code is mocked. Both engine names
 * share one state root because they are the same executable: a test can
 * interleave docker and podman invocations against one observed state.
 */

import { beforeAll, beforeEach, afterAll, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FAKE_ENGINE_SCRIPT_PATH,
  FAKE_ENGINE_STATE_ENV,
  decodeFakeEngineState,
  type FakeEngineState,
} from './fake-dependency-engine.js';

export const FAKE_ENGINE_IMAGE = 'issue3450-fake-image';

export interface FakeEngineHarness {
  /** The docker engine command value; resolves to the fake through PATH. */
  readonly command: 'docker' | 'podman';
  /** SandboxConfig-shaped config using the docker-named fake engine. */
  readonly config: { command: 'docker' | 'podman'; image: string };
  /** The same fake engine reached through the podman command name. */
  readonly podmanConfig: { command: 'podman'; image: string };
  /** Directory backing the fake engine's persistent state. */
  readonly stateRoot: string;
  /** Snapshot of the fake engine's full persistent state. */
  snapshot(): FakeEngineState;
  /** Names of the volumes the engine currently holds. */
  volumeNames(): string[];
  /** Names of the containers the engine currently holds. */
  containerNames(): string[];
  /** Full argv of every engine invocation, in order. */
  invocations(): string[][];
  /**
   * Creates a fault-injection knob; `content` is the ordinal for
   * ordinal knobs (`fail-volume-create-on`) and ignored by once-knobs
   * (`fail-run-once`, `fail-volume-rm-once`).
   */
  setKnob(knob: string, content?: string): void;
}

export function useFakeEngine(
  command: 'docker' | 'podman' = 'docker',
): FakeEngineHarness {
  const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-engine-3450-'));
  const binDir = path.join(suiteRoot, 'bin');
  const stateRoot = path.join(suiteRoot, 'state');
  let environmentSnapshot: NodeJS.ProcessEnv = {};

  beforeAll(() => {
    fs.mkdirSync(binDir, { recursive: true });
    fs.chmodSync(FAKE_ENGINE_SCRIPT_PATH, 0o755);
    for (const name of ['docker', 'podman']) {
      fs.symlinkSync(FAKE_ENGINE_SCRIPT_PATH, path.join(binDir, name));
    }
  });

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    fs.rmSync(stateRoot, { recursive: true, force: true });
    fs.mkdirSync(stateRoot, { recursive: true });
    process.env[FAKE_ENGINE_STATE_ENV] = stateRoot;
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ''}`;
  });

  afterEach(() => {
    process.env = environmentSnapshot;
  });

  afterAll(() => {
    fs.rmSync(suiteRoot, { recursive: true, force: true });
  });

  const readState = (): FakeEngineState => {
    try {
      const parsed: unknown = JSON.parse(
        fs.readFileSync(path.join(stateRoot, 'state.json'), 'utf8'),
      );
      return decodeFakeEngineState(parsed);
    } catch {
      return {
        volumes: {},
        containers: {},
        networks: {},
        invocations: [],
        counters: {},
      };
    }
  };

  return {
    command,
    config: { command, image: FAKE_ENGINE_IMAGE },
    podmanConfig: { command: 'podman', image: FAKE_ENGINE_IMAGE },
    stateRoot,
    snapshot: readState,
    volumeNames: () => Object.keys(readState().volumes),
    containerNames: () => Object.keys(readState().containers),
    invocations: () => readState().invocations.map((argv) => [...argv]),
    setKnob: (knob, content = 'fail\n') => {
      fs.writeFileSync(path.join(stateRoot, knob), content);
    },
  };
}
