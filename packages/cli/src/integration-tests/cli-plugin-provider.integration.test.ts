/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import * as path from 'node:path';
import { runCli } from './__tests__/cli-args-test-helpers.js';
import {
  cleanupTempDirectory,
  createTempDirectory,
  createTempKeyfile,
} from './test-utils.js';

describe('installed runtime plugin CLI registration', () => {
  it('activates the Gemini plugin and sends the CLI-selected model to the configured endpoint', async () => {
    const tempDir = await createTempDirectory();
    let requestedPaths: readonly string[] = [];
    const server = createServer((request, response) => {
      requestedPaths = [...requestedPaths, request.url ?? ''];
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          error: {
            code: 401,
            message: 'Invalid API key',
            status: 'UNAUTHENTICATED',
          },
        }),
      );
    });

    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('Expected the HTTP fixture to listen on a TCP port');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const keyfile = await createTempKeyfile(tempDir, 'invalid-test-key');
      const result = await runCli(
        [
          '--provider',
          'gemini',
          '--model',
          'gemini-2.5-flash',
          '--keyfile',
          keyfile,
          '--baseurl',
          baseUrl,
          '--prompt',
          'test prompt',
        ],
        { HOME: tempDir, LLXPRT_CONFIG_HOME: path.join(tempDir, 'config') },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain(
        `Error when talking to gemini (endpoint: ${baseUrl})`,
      );
      expect(requestedPaths.length).toBeGreaterThan(0);
      expect(
        requestedPaths.every((requestPath) =>
          requestPath.includes('/models/gemini-2.5-flash:'),
        ),
      ).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      await cleanupTempDirectory(tempDir);
    }
  });
});
