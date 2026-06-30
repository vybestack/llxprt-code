/**
 * Bun native-module smoke harness (issue 2239, S2).
 *
 * Verifies that the native modules the CLI depends on load and operate under
 * the Bun runtime on POSIX:
 *
 * - @ast-grep/napi — native AST engine (parse a TS snippet)
 * - @napi-rs/keyring — native OS credential store (construct-only; no I/O)
 * - web-tree-sitter + tree-sitter-bash WASM — shell parser (parse a command)
 * - Bun.Terminal PTY adapter — the bun-pty seam (spawn, stream data, real exit)
 *
 * Each check prints [PASS] or [FAIL]. Exits non-zero if any check fails.
 *
 * Usage: bun scripts/bun-native-modules-smoke.mjs
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const isBun =
  typeof globalThis.Bun !== 'undefined' &&
  typeof globalThis.Bun.spawn === 'function';
if (!isBun) {
  console.error('[FAIL] This harness must be run under Bun (bun ...).');
  process.exit(1);
}

const isPosix = process.platform !== 'win32';
let skippedChecks = 0;
if (!isPosix) {
  skippedChecks += 1;
  console.log(
    '[SKIP] Bun.Terminal PTY adapter is POSIX-only; native module checks still run on Windows.',
  );
}

let failures = 0;

function pass(name) {
  console.log(`[PASS] ${name}`);
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}

function fail(name, error) {
  failures += 1;
  console.error(`[FAIL] ${name}: ${formatError(error)}`);
}

async function waitForExit(proc, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      proc.exited,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error('timeout waiting for Bun.Terminal process exit')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function createOutputWaiter(getOutput, expected, timeoutMs) {
  let timeout;
  let resolveWait;
  const promise = new Promise((resolve) => {
    resolveWait = resolve;
    timeout = setTimeout(() => resolve(false), timeoutMs);
  }).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });

  return {
    notify() {
      if (resolveWait === null) {
        return;
      }
      if (getOutput().includes(expected)) {
        const resolve = resolveWait;
        resolveWait = null;
        resolve(true);
      }
    },
    promise,
  };
}

// ---------------------------------------------------------------------------
// 1. @ast-grep/napi
// ---------------------------------------------------------------------------
async function checkAstGrep() {
  try {
    const { Lang, parse } = await import('@ast-grep/napi');
    const ts = Lang.TypeScript;
    const ast = parse(ts, 'const x = 1;');
    const root = ast.root();
    if (root.kind() !== 'program') {
      throw new Error(`expected root kind "program", got "${root.kind()}"`);
    }
    pass('@ast-grep/napi: parse TypeScript snippet');
  } catch (e) {
    fail('@ast-grep/napi', e);
  }
}

// ---------------------------------------------------------------------------
// 2. @napi-rs/keyring (construct-only; no credential I/O)
// ---------------------------------------------------------------------------
async function checkKeyring() {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    const entry = new Entry('llxprt-smoke-test', 'llxprt-smoke-account');
    if (typeof entry !== 'object' || entry === null) {
      throw new Error('Entry constructor did not return an object');
    }
    if (typeof entry.getPassword !== 'function') {
      throw new Error('Entry instance missing getPassword method');
    }
    pass('@napi-rs/keyring: construct Entry (no credential I/O)');
  } catch (e) {
    fail('@napi-rs/keyring', e);
  }
}

// ---------------------------------------------------------------------------
// 3. web-tree-sitter + tree-sitter-bash WASM
// ---------------------------------------------------------------------------
async function checkTreeSitter() {
  try {
    const { Parser, Language } = await import('web-tree-sitter');
    await Parser.init();
    const parser = new Parser();
    const wasmPath = require.resolve('tree-sitter-bash/tree-sitter-bash.wasm');
    const wasmBytes = readFileSync(wasmPath);
    const bashLanguage = await Language.load(wasmBytes);
    parser.setLanguage(bashLanguage);
    const tree = parser.parse('echo hello');
    if (tree.rootNode.type !== 'program') {
      throw new Error(
        `expected root node type "program", got "${tree.rootNode.type}"`,
      );
    }
    pass('web-tree-sitter + tree-sitter-bash WASM: parse shell command');
  } catch (e) {
    fail('web-tree-sitter + tree-sitter-bash WASM', e);
  }
}

// ---------------------------------------------------------------------------
// 4. Bun.Terminal PTY adapter (the bun-pty seam)
// ---------------------------------------------------------------------------
async function checkBunPty() {
  if (!isPosix) {
    return;
  }
  let proc;
  let exitedCleanly = false;
  try {
    const decoder = new TextDecoder();
    let output = '';
    const outputWaiter = createOutputWaiter(
      () => output,
      'bun-pty-smoke-ok',
      2000,
    );

    const shellPath = '/bin/sh';
    proc = globalThis.Bun.spawn([shellPath, '-c', 'echo bun-pty-smoke-ok'], {
      terminal: {
        cols: 80,
        rows: 24,
        name: 'xterm-256color',
        data(_terminal, bytes) {
          output += decoder.decode(bytes, { stream: true });
          outputWaiter.notify();
        },
      },
    });

    if (typeof proc.pid !== 'number' || proc.pid <= 0) {
      throw new Error(`invalid pid: ${proc.pid}`);
    }

    const [exitResult, sawOutputBeforeExit] = await Promise.all([
      waitForExit(proc, 5000).catch((error) => error),
      outputWaiter.promise,
    ]);
    // Terminal data callbacks can lag process exit; flush the streaming decoder
    // and re-check output before declaring a missing-output failure.
    output += decoder.decode();
    const sawOutput =
      sawOutputBeforeExit || output.includes('bun-pty-smoke-ok');

    if (!sawOutput) {
      throw new Error(
        `expected output to contain "bun-pty-smoke-ok", got: ${JSON.stringify(output)}`,
      );
    }

    if (exitResult instanceof Error) {
      throw exitResult;
    }

    if (exitResult !== 0) {
      throw new Error(`expected exit code 0, got ${exitResult}`);
    }

    exitedCleanly = true;
    pass('Bun.Terminal PTY adapter: spawn, stream data, real exit code');
  } catch (e) {
    fail('Bun.Terminal PTY adapter', e);
  } finally {
    if (proc) {
      try {
        proc.terminal?.close();
      } catch {
        // Terminal may already be closed.
      }
      if (!exitedCleanly) {
        try {
          proc.kill();
        } catch {
          // Process may already have exited.
        }
        await waitForExit(proc, 1000).catch(async () => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Process may already have exited.
          }
          await waitForExit(proc, 1000).catch(() => {});
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Run all checks
// ---------------------------------------------------------------------------
await checkAstGrep();
await checkKeyring();
await checkTreeSitter();
await checkBunPty();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
if (skippedChecks > 0) {
  console.log(
    `\nAll native-module smoke checks passed under Bun (${skippedChecks} POSIX-only check skipped).`,
  );
} else {
  console.log('\nAll native-module smoke checks passed under Bun.');
}
