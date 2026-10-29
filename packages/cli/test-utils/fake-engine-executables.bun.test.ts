/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FAKE_ENGINE_BIN_ENV,
  prepareFakeEngineExecutables,
} from './fake-engine-executables.js';
import { useFakeEngine } from './fake-dependency-engine-harness.js';
import { addPrivateDependencyMounts } from '../src/utils/sandbox-node-modules.js';

const originalBin = process.env[FAKE_ENGINE_BIN_ENV];
const prepared =
  originalBin === undefined
    ? await prepareFakeEngineExecutables(
        path.resolve(import.meta.dirname, '../tmp'),
      )
    : { [FAKE_ENGINE_BIN_ENV]: originalBin };
Object.assign(process.env, prepared);
const suiteRoots: string[] = [];
afterAll(() => {
  for (const suiteRoot of suiteRoots)
    expect(fs.existsSync(suiteRoot)).toBe(false);
  expect(fs.existsSync(prepared[FAKE_ENGINE_BIN_ENV])).toBe(true);
  if (originalBin === undefined) delete process.env[FAKE_ENGINE_BIN_ENV];
  else process.env[FAKE_ENGINE_BIN_ENV] = originalBin;
});

for (const name of ['first disposable suite', 'second disposable suite']) {
  describe(name, () => {
    const engine = useFakeEngine();
    suiteRoots.push(path.dirname(engine.stateRoot));
    it('uses the runner build while keeping dependency state private and releasable', () => {
      const workspace = fs.mkdtempSync(
        path.join(os.tmpdir(), 'prepared-engine-ws-'),
      );
      const lifecycle = addPrivateDependencyMounts(
        engine.config,
        [],
        workspace,
      );
      try {
        expect(engine.volumeNames()).toHaveLength(1);
        const volume = engine.volumeNames()[0];
        expect(
          fs.readdirSync(path.join(engine.stateRoot, 'volumes', volume)),
        ).toEqual([]);
        expect(process.env.PATH?.split(path.delimiter)[0]).toBe(
          prepared[FAKE_ENGINE_BIN_ENV],
        );
      } finally {
        lifecycle.release();
        fs.rmSync(workspace, { recursive: true, force: true });
      }
      expect(engine.volumeNames()).toEqual([]);
    });
  });
}
