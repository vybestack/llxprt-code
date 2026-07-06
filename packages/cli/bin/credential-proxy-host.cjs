#!/usr/bin/env node
'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const { registerHooks, stripTypeScriptTypes } = require('node:module');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { fileURLToPath } = require('node:url');
const { PROXY_SOCKET_PREFIX } = require('./launcher-credential-env.cjs');

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
        const isNotFound = isModuleNotFound(error);
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

const PROVIDER_AUTH_SPECIFIER = '@vybestack/llxprt-code-providers/auth.js';
// Node's ESM resolver truncates a missing-package error to the bare package
// name (e.g. "Cannot find package '@scope/name' imported from ..."), so match
// that form too, not just the full subpath specifier. For a scoped package the
// root is the first two segments (@scope/name); for an unscoped package it is
// the first segment.
const PROVIDER_AUTH_PACKAGE = (() => {
  const segments = PROVIDER_AUTH_SPECIFIER.split('/');
  const rootSegmentCount = PROVIDER_AUTH_SPECIFIER.startsWith('@') ? 2 : 1;
  return segments.slice(0, rootSegmentCount).join('/');
})();

function isModuleNotFound(error) {
  return (
    error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND'
  );
}

// Returns the first single- or double-quoted token in the string, or undefined.
// Node module-not-found messages quote the unresolvable specifier first (before
// any "imported from"/require-stack trailer), so this isolates it for matching.
// The backreference enforces matching opening/closing quotes.
function extractFirstQuotedToken(message) {
  const match = /(['"])([^'"]+)\1/.exec(message);
  return match ? match[2] : undefined;
}

// True when packageName appears in token as a whole path segment (bounded by a
// path separator or the start/end of the string), so a sibling whose name only
// STARTS WITH packageName (e.g. "@scope/name-utils") is not a false match.
// Checks every occurrence, not just the first, so a non-segment-bounded earlier
// match does not hide a valid later one.
function tokenContainsPackageSegment(token, packageName) {
  let index = token.indexOf(packageName);
  while (index !== -1) {
    const prefixOk = index === 0 || token[index - 1] === '/';
    const suffixEnd = index + packageName.length;
    const suffixOk = suffixEnd === token.length || token[suffixEnd] === '/';
    if (prefixOk && suffixOk) {
      return true;
    }
    index = token.indexOf(packageName, index + 1);
  }
  return false;
}

function isProviderAuthModuleNotFound(error) {
  if (!isModuleNotFound(error)) {
    return false;
  }
  // Only treat this as "the provider auth module itself is missing" when the
  // error names it. A MODULE_NOT_FOUND from a transitive dependency inside the
  // module must propagate so the real root cause is not masked by the
  // TypeScript-stripping fallback (which cannot fix a missing transitive dep).
  const message =
    error instanceof Error && typeof error.message === 'string'
      ? error.message
      : '';
  // Node quotes the UNRESOLVABLE specifier first in the message. Depending on
  // how the provider auth entry is resolved, that quoted token is either the
  // bare specifier ("@scope/name/auth.js"), the package name for an ESM missing
  // package ("@scope/name"), or the absolute resolved path when a subpath
  // export points at a missing built file (".../@scope/name/dist/.../index.js").
  // All three contain the package name. A missing TRANSITIVE dependency instead
  // quotes that dependency's own specifier (e.g. "some-dep"), which does NOT
  // contain the package name — so it correctly propagates. Extract the first
  // quoted token and test it against the package name.
  const quoted = extractFirstQuotedToken(message);
  return (
    quoted !== undefined &&
    tokenContainsPackageSegment(quoted, PROVIDER_AUTH_PACKAGE)
  );
}

async function loadProviderAuth() {
  let firstError;
  try {
    return await import(PROVIDER_AUTH_SPECIFIER);
  } catch (error) {
    if (!isProviderAuthModuleNotFound(error)) {
      throw error;
    }
    firstError = error;
    // Preserve the first failure's detail before falling through to the
    // TypeScript-stripping resolver. The parent launcher captures this
    // sidecar's stderr, so if the fallback import also fails the original root
    // cause remains visible for debugging.
    process.stderr.write(
      `provider auth module not resolved as built JS, retrying with TypeScript stripping: ${describeError(error)}\n`,
    );
  }
  try {
    registerTypeScriptSourceResolver();
    return await import(PROVIDER_AUTH_SPECIFIER);
  } catch (fallbackError) {
    // Link the original failure via the standard cause chain so the root cause
    // is correlatable even if the fallback (resolver registration or import)
    // fails for a different reason.
    if (firstError !== undefined && fallbackError instanceof Error) {
      fallbackError.cause ??= firstError;
    }
    throw fallbackError;
  }
}

async function main() {
  const { createAndStartProxy, getProxySocketPath, stopProxy } =
    await loadProviderAuth();

  // This sidecar owns the socket directory it creates and removes it during a
  // graceful shutdown. The directory is also reported to the parent launcher so
  // it can take over cleanup only if it must escalate to SIGKILL (where this
  // process is terminated before its own cleanup can run).
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

    process.stdout.write(`${JSON.stringify({ socketDir, socketPath })}\n`);
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

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${describeError(error)}\n`);
    process.exit(1);
  });
}

// Exposed for unit testing the module-not-found matching logic without
// executing the sidecar. main() only runs when invoked as the entry point.
module.exports = {
  isModuleNotFound,
  isProviderAuthModuleNotFound,
  PROVIDER_AUTH_SPECIFIER,
  PROVIDER_AUTH_PACKAGE,
};
