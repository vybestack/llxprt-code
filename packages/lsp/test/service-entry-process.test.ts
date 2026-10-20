/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  cp,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';

it.each(['plain-', 'reserved-#-%-'] as const)(
  'starts the real service from the native %s entry path',
  async (prefix) => {
    const packageRoot = resolve(import.meta.dirname, '..');
    const root = await realpath(
      await mkdtemp(join(tmpdir(), `lsp-entry-${prefix}`)),
    );
    try {
      await cp(join(packageRoot, 'src'), join(root, 'src'), {
        recursive: true,
      });
      await cp(join(packageRoot, 'package.json'), join(root, 'package.json'));
      await symlink(
        resolve(packageRoot, '../../node_modules'),
        join(root, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const file = join(root, 'input.ts');
      await writeFile(file, 'const value = TYPE_ERROR;\n');
      const entry = join(root, 'src', 'main.ts');
      const bootstrap = {
        workspaceRoot: root,
        config: {
          servers: [
            {
              id: 'ts',
              command: process.execPath,
              args: [
                join(packageRoot, 'test', 'fixtures', 'fake-lsp-server.ts'),
              ],
              extensions: ['.ts'],
            },
          ],
          navigationTools: true,
        },
      };
      const child = spawn(process.execPath, [entry], {
        cwd: root,
        env: { ...process.env, LSP_BOOTSTRAP: JSON.stringify(bootstrap) },
        stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      });
      const closed = once(child, 'close');
      const stderr: Buffer[] = [];
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      const connection = createMessageConnection(
        new StreamMessageReader(child.stdout),
        new StreamMessageWriter(child.stdin),
      );
      try {
        const ready = new Promise<void>((resolveReady, reject) => {
          connection.onNotification('lsp/ready', resolveReady);
          child.once('error', reject);
          child.once('exit', (code, signal) =>
            reject(
              new Error(
                JSON.stringify({
                  firstChild: 'Bun LSP service',
                  pid: child.pid,
                  executable: process.execPath,
                  argv: [entry],
                  cwd: root,
                  bootstrap,
                  stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
                  code,
                  signal,
                  stderr: Buffer.concat(stderr).toString('utf8'),
                }),
              ),
            ),
          );
        });
        connection.listen();
        await ready;
        const diagnostics = await connection.sendRequest<unknown[]>(
          'lsp/checkFile',
          { filePath: file },
        );
        expect(diagnostics.length).toBeGreaterThan(0);
        const statuses =
          await connection.sendRequest<
            Array<{ serverId: string; state: string }>
          >('lsp/status');
        expect(statuses).toContainEqual(
          expect.objectContaining({ serverId: 'ts', state: 'ok' }),
        );
        await connection.sendRequest('lsp/shutdown');
      } finally {
        connection.dispose();
        if (child.exitCode === null && child.signalCode === null)
          child.kill('SIGTERM');
        await closed;
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  15_000,
);
