/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

describe('Podman overlap fixture admission', () => {
  it.skipIf(process.platform === 'win32')(
    'waits for the real SSH body receipt before publishing readiness, then cancels and reaps the overlapping probe',
    async () => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'podman-overlap-admission-'),
      );
      const preload = path.join(root, 'hold-ssh-body.ts');
      const release = path.join(root, 'release-ssh');
      const probeEntered = path.join(root, 'probe-entered');
      const sshHeld = path.join(root, 'ssh-held');
      const fixtureReceipt = path.join(root, 'fixture-root');
      const quote = (value: string): string =>
        `'${value.replaceAll("'", "'\\''")}'`;
      fs.writeFileSync(
        preload,
        [
          "import fs from 'node:fs';",
          "import path from 'node:path';",
          `const root = ${JSON.stringify(root)};`,
          'const write = fs.writeFileSync.bind(fs);',
          'const remove = fs.rmSync.bind(fs);',
          "let fixtureRoot = '';",
          'fs.writeFileSync = (file, data, options) => {',
          "  if (typeof file === 'string' && typeof data === 'string') {",
          "    if (path.basename(file) === 'ssh') {",
          '      fixtureRoot = path.dirname(file);',
          `      write(${JSON.stringify(fixtureReceipt)}, fixtureRoot);`,
          `      const gate = ${JSON.stringify(`printf '%s\n' "$$" > ${quote(sshHeld)}\nwhile [ ! -s ${quote(release)} ]; do sleep 0.01; done\n`)};`,
          `      data = data.replace(${JSON.stringify('#!/bin/sh\n')}, () => ${JSON.stringify('#!/bin/sh\n')} + gate);`,
          "    } else if (path.basename(file) === 'podman') {",
          `      const entry = ${JSON.stringify(`    printf '%s\n' "$$" > ${quote(probeEntered)}\n`)};`,
          `      data = data.replace(${JSON.stringify('  *)\n')}, () => ${JSON.stringify('  *)\n')} + entry);`,
          '    }',
          '  }',
          '  return write(file, data, options);',
          '};',
          'fs.rmSync = (file, options) => {',
          '  if (file === fixtureRoot) {',
          "    for (const name of ['ssh.pid', 'probe.pid', 'readiness-started', 'bridge-result-time']) {",
          '      const source = path.join(fixtureRoot, name);',
          '      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(root, name));',
          '    }',
          "    const sshPid = path.join(fixtureRoot, 'ssh.pid');",
          '    if (fs.existsSync(sshPid)) {',
          "      write(path.join(root, 'ssh-body-time'), String(Math.floor(fs.statSync(sshPid).mtimeMs)));",
          '    }',
          '  }',
          '  return remove(file, options);',
          '};',
        ].join('\n'),
      );
      const child = spawn(
        process.execPath,
        [
          'test',
          '--timeout',
          '30000',
          '--preload',
          preload,
          './src/utils/sandbox-podman-diagnostics.test.ts',
          '--test-name-pattern',
          'surfaces SSH diagnostics when a readiness probe overlaps SSH exit',
        ],
        {
          cwd: path.resolve(import.meta.dirname, '../..'),
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10000,
        },
      );
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      const exited = new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      try {
        while (!fs.existsSync(probeEntered) || !fs.existsSync(sshHeld)) {
          if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(`Overlap case exited before admission: ${output}`);
          }
          await delay(10);
        }
        const fixtureRoot = fs.readFileSync(fixtureReceipt, 'utf8');
        fs.writeFileSync(path.join(fixtureRoot, 'ssh.pid'), '');
        await delay(200);
        const readinessBeforeAdmission = fs.existsSync(
          path.join(fixtureRoot, 'readiness-started'),
        );
        fs.writeFileSync(release, 'admit');
        const status = await exited;
        if (status !== 0) {
          throw new Error(`Original overlap case failed: ${output}`);
        }

        expect(readinessBeforeAdmission).toBe(false);
        const readinessTime = Number(
          fs.readFileSync(path.join(root, 'readiness-started'), 'utf8'),
        );
        const sshBodyTime = Number(
          fs.readFileSync(path.join(root, 'ssh-body-time'), 'utf8'),
        );
        expect(readinessTime).toBeGreaterThanOrEqual(sshBodyTime);
        const sshPid = Number(
          fs.readFileSync(path.join(root, 'ssh.pid'), 'utf8'),
        );
        const probePid = Number(
          fs.readFileSync(path.join(root, 'probe.pid'), 'utf8'),
        );
        const readinessPid = Number(fs.readFileSync(probeEntered, 'utf8'));
        expect(processExists(sshPid)).toBe(false);
        expect(processExists(probePid)).toBe(false);
        expect(processExists(readinessPid)).toBe(false);
      } finally {
        fs.writeFileSync(release, 'admit');
        await exited;
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    10000,
  );
});
