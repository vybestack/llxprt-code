#!/usr/bin/env node
'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const { registerHooks, stripTypeScriptTypes } = require('node:module');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { fileURLToPath } = require('node:url');

const PROXY_SOCKET_PREFIX = 'lxcp-';

function shouldTransformTypeScriptUrl(url) {
  return (
    url.startsWith('file:') &&
    !url.endsWith('.d.ts') &&
    !url.endsWith('.d.mts') &&
    !url.endsWith('.d.cts') &&
    (url.endsWith('.ts') || url.endsWith('.mts') || url.endsWith('.cts'))
  );
}

function getTypeScriptModuleFormat(url, context) {
  if (url.endsWith('.cts') || context.format === 'commonjs') {
    return 'commonjs';
  }
  return 'module';
}

function registerTypeScriptSourceResolver() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const shouldUseBunCondition = specifier.startsWith('@vybestack/');
      const conditions =
        context.conditions?.includes('bun') || !shouldUseBunCondition
          ? context.conditions
          : [...(context.conditions ?? []), 'bun'];
      try {
        return nextResolve(specifier, { ...context, conditions });
      } catch (error) {
        const isNotFound =
          error?.code === 'ERR_MODULE_NOT_FOUND' ||
          error?.code === 'MODULE_NOT_FOUND';
        if (
          isNotFound &&
          specifier.endsWith('.js') &&
          context.parentURL?.startsWith('file:')
        ) {
          const tsUrl = new URL(
            specifier.replace(/\.js$/, '.ts'),
            context.parentURL,
          );
          if (existsSync(fileURLToPath(tsUrl))) {
            return { url: tsUrl.href, shortCircuit: true };
          }
        }
        throw error;
      }
    },
    load(url, context, nextLoad) {
      if (shouldTransformTypeScriptUrl(url)) {
        const source = readFileSync(fileURLToPath(url), 'utf8');
        return {
          format: getTypeScriptModuleFormat(url, context),
          shortCircuit: true,
          source: stripTypeScriptTypes(source, { mode: 'transform' }),
        };
      }
      return nextLoad(url, context);
    },
  });
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  registerTypeScriptSourceResolver();
  const { createAndStartProxy, getProxySocketPath, stopProxy } = await import(
    '@vybestack/llxprt-code-providers/auth.js'
  );

  const socketDir = await mkdtemp(join(tmpdir(), PROXY_SOCKET_PREFIX));
  let handle;
  let stopping = false;
  let shuttingDown = false;

  async function stop() {
    if (stopping) {
      return;
    }
    stopping = true;
    try {
      await handle?.stop();
    } catch (error) {
      process.stderr.write(`${describeError(error)}\n`);
    } finally {
      await rm(socketDir, { force: true, recursive: true }).catch(() => {});
    }
  }

  function shutdown(exitCode) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void stop().finally(() => process.exit(exitCode));
  }

  let pendingSignalExitCode;
  const requestShutdown = (exitCode) => {
    if (handle === undefined) {
      pendingSignalExitCode ??= exitCode;
      return;
    }
    shutdown(exitCode);
  };

  process.once('SIGTERM', () => requestShutdown(0));
  process.once('SIGINT', () => requestShutdown(130));
  process.once('SIGHUP', () => requestShutdown(129));

  try {
    handle = await createAndStartProxy({ socketPath: socketDir });
    const socketPath = getProxySocketPath();
    if (socketPath === undefined) {
      throw new Error('proxy socket path was not reported');
    }
    if (pendingSignalExitCode !== undefined) {
      shutdown(pendingSignalExitCode);
      return;
    }

    process.stdout.write(`${JSON.stringify({ socketPath })}\n`);
    process.stdin.once('end', () => shutdown(0));
    process.stdin.once('close', () => shutdown(0));
    process.stdin.resume();
  } catch (error) {
    if (handle === undefined) {
      await stopProxy().catch(() => {});
    }
    await stop().catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${describeError(error)}\n`);
  process.exit(1);
});
