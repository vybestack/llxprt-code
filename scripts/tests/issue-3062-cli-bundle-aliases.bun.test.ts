/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3062 (AC1/AC2) — the prebuilt CLI bundle must ship the built-in
 * provider alias data so an explicitly configured `openai` provider activates.
 *
 * Root cause: `buildCliBundle()` emitted only `bundle/llxprt.js`. The bundled
 * `providerAliases` loader looks for built-in alias data at
 * `bundle/providers/aliases` (relative to the bundle), found nothing, so
 * `createProviderManager()` registered no built-in providers and
 * `--provider openai` failed with `Provider 'openai' not found`.
 *
 * This builds the real CLI bundle via the publish-time `buildCliBundle()`,
 * asserts the alias assets are emitted at the path the bundled loader reads,
 * then executes the artifact against a local OpenAI-compatible SSE fixture.
 * On the issue baseline the assets are absent and the bundle reports the
 * missing provider; after the fix `openai` activates and the fixture receives
 * the chat-completion request.
 *
 * Gated behind `LLXPRT_RUN_BUNDLE_BUILD_TEST=1` (the build takes ~20s), the
 * same gate as the issue #2999 launchability test, so the default shard stays
 * fast while nightly CI exercises it.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAliasAssets } from '../bun-build.config.ts';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, '..', '..', '..');
// process.execPath is the Bun running this test; the node_modules/bun layout is
// platform-specific and absent on some dev machines.
const bunExecutable = process.execPath;
const bundleDir = join(repoRoot, 'packages', 'cli', 'bundle');
const bundlePath = join(bundleDir, 'llxprt.js');
const bundleAliasDir = join(bundleDir, 'providers', 'aliases');
const sourceAliasDir = join(
  repoRoot,
  'packages',
  'providers',
  'src',
  'composition',
  'aliases',
);

const RUN_BUILD_TEST = process.env.LLXPRT_RUN_BUNDLE_BUILD_TEST === '1';

/**
 * A minimal OpenAI-compatible SSE server: it streams a chat-completion whose
 * assistant text is `haiku`, answers `/models`, and records every
 * chat-completion hit so the test can prove the provider actually reached the
 * endpoint rather than failing at activation.
 */
function startFixture(): Promise<{
  server: Server;
  port: number;
  chatHits: () => number;
  awaitChatHit: () => Promise<void>;
}> {
  let chatHits = 0;
  let firstHit: () => void;
  const firstHitPromise = new Promise<void>((resolvePromise) => {
    firstHit = resolvePromise;
  });
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    if (req.method === 'GET' && url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'gpt-5.5', object: 'model', owned_by: 'test' }],
        }),
      );
      return;
    }
    if (req.method === 'POST' && url.includes('chat/completions')) {
      chatHits += 1;
      firstHit();
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const chunk = (delta: Record<string, unknown>, finish: string | null) =>
        'data: ' +
        JSON.stringify({
          id: 'chatcmpl-3062',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-5.5',
          choices: [{ index: 0, delta, finish_reason: finish }],
        }) +
        '\n\n';
      res.write(chunk({ role: 'assistant', content: 'hai' }, null));
      res.write(chunk({ content: 'ku' }, null));
      res.write(chunk({}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr !== null && typeof addr === 'object' ? addr.port : 0;
      resolvePromise({
        server,
        port,
        chatHits: () => chatHits,
        awaitChatHit: () => firstHitPromise,
      });
    });
  });
}

describe.skipIf(!RUN_BUILD_TEST)(
  'issue #3062: CLI bundle ships built-in provider aliases and activates openai',
  () => {
    // The bundle is a gitignored publish artifact; clean it so a stale copy
    // cannot mask a regression in either the build or the alias emission.
    afterAll(() => {
      rmSync(bundleDir, { recursive: true, force: true });
    });

    it('the CLI bundle build emits the built-in alias assets the bundled loader reads', () => {
      rmSync(bundleDir, { recursive: true, force: true });

      // Build via the same publish-time script `prepack`/`bundle:cli` invoke.
      // A subprocess is used (rather than calling buildCliBundle() in-process)
      // because Bun's in-test bundler cannot resolve the CLI's dynamic imports
      // on every host, whereas the script-mode bundler always can; this is the
      // real publish boundary either way.
      const buildScript = join(repoRoot, 'scripts', 'bun-build.config.ts');
      const build = spawnSync(bunExecutable, [buildScript, '--cli-only'], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, CI: 'true' },
      });
      if (build.status !== 0) {
        throw new Error(
          `CLI bundle build failed (exit=${build.status}):\n${build.stderr ?? ''}`,
        );
      }

      expect(existsSync(bundlePath)).toBe(true);
      // The bundled loader reads bundle/providers/aliases (providerAliases.ts);
      // openai.config must be present or `--provider openai` cannot activate.
      expect(existsSync(join(bundleAliasDir, 'openai.config'))).toBe(true);

      // Every shipped built-in alias asset must be emitted, not just openai.
      const sourceAssets = readdirSync(sourceAliasDir).filter(
        (name) => name.endsWith('.config') || name.endsWith('.json'),
      );
      expect(sourceAssets.length).toBeGreaterThan(0);
      for (const name of sourceAssets) {
        expect(existsSync(join(bundleAliasDir, name))).toBe(true);
      }
    }, 180_000);

    it('activates the openai provider and reaches the OpenAI-compatible fixture', async () => {
      // The previous test built the bundle + aliases; assert the artifact exists
      // so a missing build surfaces here rather than as an opaque spawn error.
      expect(existsSync(bundlePath)).toBe(true);

      const fixture = await startFixture();
      // The fixture is an in-process HTTP server, so the bundle must run as an
      // async child (not spawnSync, which would block this process's event loop
      // and starve the server).
      let child: ChildProcess | undefined;
      let stdout = '';
      let stderr = '';
      let exited = false;
      try {
        child = spawn(
          bunExecutable,
          [
            bundlePath,
            '--provider',
            'openai',
            '--model',
            'gpt-5.5',
            '--baseurl',
            `http://127.0.0.1:${fixture.port}/v1`,
            '--prompt',
            'Reply with exactly: haiku',
          ],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
              ...process.env,
              OPENAI_API_KEY: 'test-key',
              CI: 'true',
            },
          },
        );
        child.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        child.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        // Track the real exit so cleanup only terminates a still-running child
        // and the success path can await a bounded clean completion. Spawn
        // failures (e.g. ENOENT) emit 'error' with no following 'exit'; route
        // them through this same lifecycle so the test fails with the real
        // error instead of crashing on an unhandled EventEmitter emission. The
        // handler is attached inside the executor, where rejectExit is already
        // bound (attaching it earlier would reference it before assignment).
        const exitInfo = new Promise<{
          code: number | null;
          signal: NodeJS.Signals | null;
        }>((resolveExit, rejectExit) => {
          child!.once('exit', (code, signal) => {
            exited = true;
            resolveExit({ code, signal });
          });
          child!.once('error', (error: Error) => {
            exited = true;
            rejectExit(error);
          });
        });

        // Phase 1: prove the provider activated and reached the endpoint. If the
        // child exits before the first chat-completion request, that is a
        // failure; bound it so a hang cannot stall CI.
        const reachedEndpoint = await Promise.race([
          fixture.awaitChatHit().then(() => true),
          exitInfo.then(() => false),
          new Promise<boolean>((resolveTimeout) =>
            setTimeout(() => resolveTimeout(false), 60_000),
          ),
        ]);
        expect(reachedEndpoint).toBe(true);

        // Give stdout a tick to flush after the hit.
        await new Promise((done) => setTimeout(done, 500));

        const combined = `${stdout}${stderr}`;
        // Activation proof #1: no missing-provider failure.
        expect(combined).not.toContain("Provider 'openai' not found");
        // Activation proof #2: the provider made a real chat-completion request.
        expect(fixture.chatHits()).toBeGreaterThan(0);
        // The streamed fixture response reaches the prompt output.
        expect(combined).toContain('haiku');

        // Phase 2: the bundled CLI must complete cleanly at the CI command
        // boundary. Independent execution produces the response and exits 0; a
        // hang, signal, or non-zero exit is a regression.
        const cleanExit = await Promise.race([
          exitInfo,
          new Promise<{
            code: number | null;
            signal: NodeJS.Signals | null;
          }>((resolveTimeout) =>
            setTimeout(
              () => resolveTimeout({ code: null, signal: null }),
              60_000,
            ),
          ),
        ]);
        expect(cleanExit.code).toBe(0);
        expect(cleanExit.signal).toBeNull();
      } finally {
        // Exact-child cleanup: terminate only the spawned child (never a
        // pattern-based kill) and await its bounded exit so no zombie lingers.
        // A child that already settled (clean exit or spawn error, both set
        // `exited`) is left alone; no speculative SIGKILL escalation. The exit
        // listener is attached before signalling so the reap is never missed.
        if (!exited && child) {
          const reaped = new Promise<void>((resolveReap) => {
            const timer = setTimeout(resolveReap, 10_000);
            child!.once('exit', () => {
              clearTimeout(timer);
              resolveReap();
            });
          });
          child.kill('SIGTERM');
          await reaped;
        }
        await new Promise<void>((done) => fixture.server.close(() => done()));
      }
    }, 180_000);
  },
);

/**
 * Issue #3062 (build-input guard) — `buildCliBundle()` must fail fast rather
 * than ship a bundle with zero built-in alias assets. This exercises the
 * extracted `collectAliasAssets` directly so the guard is covered by a cheap,
 * always-on unit test (no ~20s build required).
 */
describe('issue #3062: collectAliasAssets fail-fast on empty alias assets', () => {
  it('throws when the directory has no .config/.json assets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'llxprt-alias-empty-'));
    try {
      expect(() => collectAliasAssets(dir)).toThrow(
        /no built-in provider alias assets/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('collects only .config and .json assets from a populated directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'llxprt-alias-populated-'));
    try {
      writeFileSync(join(dir, 'openai.config'), 'test');
      writeFileSync(join(dir, 'vertex.json'), '{}');
      writeFileSync(join(dir, 'README.md'), 'ignored');
      const assets = collectAliasAssets(dir);
      expect(assets).toEqual(
        expect.arrayContaining(['openai.config', 'vertex.json']),
      );
      expect(assets).not.toContain('README.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
