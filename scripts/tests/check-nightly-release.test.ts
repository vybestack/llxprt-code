/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer, type Server } from 'node:http';
import {
  checkNightlyPresence,
  decideNightlyPresence,
  expectedReleasePackages,
} from '../check-nightly-release.ts';

const packages = [
  '@vybestack/llxprt-code-tools',
  '@vybestack/llxprt-code-zed-acp',
  '@vybestack/llxprt-code',
  '@vybestack/llxprt-plugin-google-gemini',
  '@vybestack/llxprt-plugin-google-mcp-auth',
];
const servers: Server[] = [];
afterEach(() =>
  Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  ),
);

type Fixture = { status: number; body?: string; drop?: boolean };
async function registry(
  responseFor: (pathname: string) => Fixture,
): Promise<string> {
  const server = createServer((request, response) => {
    const fixture = responseFor(decodeURIComponent(request.url ?? ''));
    if (fixture.drop) {
      request.socket.destroy();
      return;
    }
    response.statusCode = fixture.status;
    response.setHeader('content-type', 'application/json');
    response.end(
      fixture.body ??
        JSON.stringify({
          versions: {
            '1.2.3': { version: '1.2.3' },
            '1.0.0': { version: '1.0.0' },
          },
        }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Registry did not bind TCP port.');
  return `http://127.0.0.1:${address.port}`;
}
const ok = (body?: string): Fixture => ({ status: 200, body });
const missing = (): Fixture => ({ status: 404 });

describe('nightly package presence', () => {
  it('proceeds when the exact version is absent from every package, including both runtime plugins', async () => {
    expect(
      await checkNightlyPresence('9.9.9', packages, await registry(() => ok())),
    ).toBe('proceed');
  });

  it('skips only when every expected package exact version exists', async () => {
    expect(
      await checkNightlyPresence('1.2.3', packages, await registry(() => ok())),
    ).toBe('duplicate');
  });

  it('treats an existing package with older versions as absent for this exact version', async () => {
    const oldOnly = JSON.stringify({
      versions: { '1.0.0': { version: '1.0.0' } },
    });
    expect(
      await checkNightlyPresence(
        '9.9.9',
        packages,
        await registry(() => ok(oldOnly)),
      ),
    ).toBe('proceed');
  });

  for (const absentPackage of packages.slice(1)) {
    it(`rejects a partial release missing ${absentPackage}`, async () => {
      await expect(
        checkNightlyPresence(
          '1.2.3',
          packages,
          await registry((url) =>
            url.includes(absentPackage) ? missing() : ok(),
          ),
        ),
      ).rejects.toThrow(/partially published/i);
    });
  }

  it('rejects malformed JSON from the external registry', async () => {
    await expect(
      checkNightlyPresence(
        '1.2.3',
        [packages[0]],
        await registry(() => ok('{')),
      ),
    ).rejects.toThrow();
  });

  it('rejects metadata without versions', async () => {
    await expect(
      checkNightlyPresence(
        '1.2.3',
        [packages[0]],
        await registry(() => ok(JSON.stringify({ name: 'package' }))),
      ),
    ).rejects.toThrow(/invalid package metadata/i);
  });

  it('rejects array-shaped versions in external package metadata', async () => {
    await expect(
      checkNightlyPresence(
        '1.2.3',
        [packages[0]],
        await registry(() => ok(JSON.stringify({ versions: [] }))),
      ),
    ).rejects.toThrow(/invalid package metadata/i);
  });

  it('fails closed for dropped connections and relevant registry HTTP errors', async () => {
    await expect(
      checkNightlyPresence(
        '1.2.3',
        [packages[0]],
        await registry(() => ({ status: 200, drop: true })),
      ),
    ).rejects.toThrow();
    for (const status of [401, 429, 503]) {
      await expect(
        checkNightlyPresence(
          '1.2.3',
          [packages[0]],
          await registry(() => ({ status })),
        ),
      ).rejects.toThrow(new RegExp(`HTTP ${status}`));
    }
  });

  it('fails inventory discovery when a configured workspace package is missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-inventory-'));
    try {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ workspaces: ['packages/missing'] }),
      );
      expect(() => expectedReleasePackages(root)).toThrow(
        /workspace package manifest is missing.*packages\/missing/i,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('derives expected publish inventory including Zed, CLI, and both runtime plugins', () => {
    const names = expectedReleasePackages(process.cwd());
    expect(names).toContain('@vybestack/llxprt-code-zed-acp');
    expect(names).toContain('@vybestack/llxprt-code');
    expect(names).toContain('@vybestack/llxprt-plugin-google-gemini');
    expect(names).toContain('@vybestack/llxprt-plugin-google-mcp-auth');
  });

  it('rejects incomplete observations rather than treating them as absence', () => {
    expect(() => decideNightlyPresence(['present'], packages)).toThrow(
      /did not cover/,
    );
  });
});
