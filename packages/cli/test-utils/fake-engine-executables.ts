/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FAKE_ENGINE_SCRIPT_PATH } from './fake-dependency-engine.js';
import { psExecutableSource } from './ps-executable-fixture.js';
import { fixtureExecutablePath } from './sandbox-fixture-compiler.js';

export const FAKE_ENGINE_BIN_ENV = 'LLXPRT_TEST_ENGINE_BIN';

/** Build once before the runner starts its workers, outside test deadlines. */
export async function prepareFakeEngineExecutables(
  buildRoot: string,
): Promise<Record<typeof FAKE_ENGINE_BIN_ENV, string>> {
  fs.mkdirSync(buildRoot, { recursive: true });
  const bin = fs.mkdtempSync(path.join(buildRoot, 'sandbox-fixture-build-'));
  const psSource = path.join(bin, 'ps.fixture.ts');
  fs.writeFileSync(psSource, psExecutableSource());
  try {
    for (const [name, source] of [
      ['docker', FAKE_ENGINE_SCRIPT_PATH],
      ['ps', psSource],
    ]) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            'build',
            '--compile',
            source,
            '--outfile',
            fixtureExecutablePath(bin, name),
          ],
          { cwd: bin, stdio: 'inherit', windowsHide: true },
        );
        child.once('error', reject);
        child.once('close', (code, signal) => {
          if (code === 0) resolve();
          else
            reject(
              new Error(
                `Failed to build ${name}: code=${code}, signal=${signal}`,
              ),
            );
        });
      });
    }
    fs.copyFileSync(
      fixtureExecutablePath(bin, 'docker'),
      fixtureExecutablePath(bin, 'podman'),
    );
    return { [FAKE_ENGINE_BIN_ENV]: bin };
  } finally {
    fs.rmSync(psSource, { force: true });
  }
}

if (import.meta.main) {
  const env = await prepareFakeEngineExecutables(
    path.resolve(import.meta.dirname, '../tmp'),
  );
  console.log(`${FAKE_ENGINE_BIN_ENV}=${env[FAKE_ENGINE_BIN_ENV]}`);
}
