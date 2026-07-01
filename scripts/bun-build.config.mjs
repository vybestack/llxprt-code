/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun-based bundling for the CLI and a2a-server distributable artifacts.
 * Replaces the retired `esbuild.config.js`.
 *
 * The run path no longer requires a bundle — Bun executes the TypeScript
 * source directly via the S3 launcher. This script produces the self-contained
 * `bundle/llxprt.js` and `packages/a2a-server/dist/a2a-server.mjs` release
 * artifacts (the actual release packaging is finalized in S7).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

/**
 * Modules that must remain external in the bundle. These are either native
 * addons (`.node`), Bun-specific UI packages, or optional platform binaries
 * that cannot be bundled.
 */
const EXTERNALS = [
  '@lydell/node-pty',
  'node-pty',
  '@lydell/node-pty-darwin-arm64',
  '@lydell/node-pty-darwin-x64',
  '@lydell/node-pty-linux-x64',
  '@lydell/node-pty-win32-arm64',
  '@lydell/node-pty-win32-x64',
  '@napi-rs/keyring',
  'node:module',
  // UI package uses opentui which has Bun-specific imports.
  '@vybestack/llxprt-ui',
  '@vybestack/opentui-core',
  '@vybestack/opentui-react',
  // ast-grep uses native Node.js addons (.node files) that cannot be bundled.
  '@ast-grep/napi',
  '@ast-grep/lang-python',
  '@ast-grep/lang-go',
  '@ast-grep/lang-rust',
  '@ast-grep/lang-java',
  '@ast-grep/lang-cpp',
  '@ast-grep/lang-c',
  '@ast-grep/lang-json',
  '@ast-grep/lang-ruby',
  '@ast-grep/lang-csharp',
  '@ast-grep/lang-kotlin',
  '@ast-grep/lang-php',
  '@ast-grep/lang-scala',
  '@ast-grep/lang-swift',
  // Optional prompt watcher dependency; runtime falls back to fs.watch.
  'chokidar',
];

/**
 * Stub plugin for the `is-in-ci` package. The original npm package detects CI
 * environments, which causes ink to suppress its UI rendering. We always return
 * false so the interactive CLI UI renders even under CI runners. See #1563.
 */
const isInCiStubPlugin = {
  name: 'is-in-ci-stub',
  setup(build) {
    build.onResolve({ filter: /^is-in-ci$/ }, () => ({
      path: 'is-in-ci',
      namespace: 'is-in-ci-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'is-in-ci-stub' }, () => ({
      contents: 'export default false;',
      loader: 'js',
    }));
  },
};

const SHARED_CONFIG = {
  bundle: true,
  target: 'node',
  format: 'esm',
  conditions: ['production'],
  external: EXTERNALS,
  loader: { '.node': 'file' },
  minify: true,
  splitting: false,
  sourcemap: 'none',
  define: {
    'process.env.CLI_VERSION': JSON.stringify(pkg.version),
    'process.env.NODE_ENV': '"production"',
  },
};

// CLI bundle: packages/cli/index.ts -> bundle/llxprt.js
const cliConfig = {
  ...SHARED_CONFIG,
  entrypoints: ['packages/cli/index.ts'],
  outdir: 'bundle',
  naming: 'llxprt.js',
  plugins: [isInCiStubPlugin],
  banner: `import * as nodeModule from 'node:module'; const require = nodeModule.createRequire(import.meta.url); globalThis.__filename = require('url').fileURLToPath(import.meta.url); globalThis.__dirname = require('path').dirname(globalThis.__filename);`,
};

// a2a-server bundle: packages/a2a-server/src/http/server.ts -> dist/a2a-server.mjs
const a2aServerConfig = {
  ...SHARED_CONFIG,
  entrypoints: ['packages/a2a-server/src/http/server.ts'],
  outdir: 'packages/a2a-server/dist',
  naming: 'a2a-server.mjs',
  // a2a-server does not import bare 'module'. A static import avoids
  // Top-Level Await and keeps the banner consistent with the CLI bundle.
  banner: `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); globalThis.__filename = require('url').fileURLToPath(import.meta.url); globalThis.__dirname = require('path').dirname(globalThis.__filename);`,
};

const { build } = await import('bun');

// Execute both builds. CLI failure is fatal; a2a-server failure is non-fatal
// (matches the previous esbuild Promise.allSettled semantics).
const results = await Promise.allSettled([
  build(cliConfig),
  build(a2aServerConfig),
]);
const [cliResult, a2aResult] = results;

// Bun.build() resolves (does not reject) with a result whose `success` flag
// can be false when the build produced diagnostics (unresolved imports, etc.).
// A rejected promise is also possible for hard failures. Both must be treated
// as failures: a fulfilled `success: false` CLI build is fatal so stale
// artifacts are never shipped downstream.
// `reportLogs` is only invoked for fulfilled-but-unsuccessful results; the
// rejected paths log `result.reason` inline at their call sites.
function reportLogs(label, result) {
  const detail = (result.value?.logs ?? []).map((l) => l.message).join('; ');
  console.warn(label + ' build logs: ' + (detail || '(none)'));
}

const cliOk =
  cliResult.status === 'fulfilled' && cliResult.value.success !== false;
if (!cliOk) {
  if (cliResult.status === 'rejected') {
    console.error('llxprt.js build failed:', cliResult.reason);
  } else {
    console.error('llxprt.js build completed with errors.');
    reportLogs('llxprt.js', cliResult);
  }
  process.exit(1);
}

const a2aOk =
  a2aResult.status === 'fulfilled' && a2aResult.value.success !== false;
if (!a2aOk) {
  if (a2aResult.status === 'rejected') {
    console.warn('a2a-server build failed:', a2aResult.reason);
  } else {
    console.warn('a2a-server build completed with errors (non-fatal).');
    reportLogs('a2a-server', a2aResult);
  }
}

console.log(
  'bun build complete:',
  cliResult.value.outputs.map((o) => `${o.path}=${o.size}`),
  a2aOk
    ? a2aResult.value.outputs.map((o) => `${o.path}=${o.size}`)
    : 'a2a failed (non-fatal)',
);
