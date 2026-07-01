/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun-based bundling for the a2a-server distributable artifact.
 * Replaces the retired `esbuild.config.js`.
 *
 * The CLI run path no longer requires a bundle — Bun executes the TypeScript
 * source directly via the S3 launcher, and the published bin is the compiled
 * `packages/cli/dist/index.js` entry. This script produces only the
 * self-contained `packages/a2a-server/dist/a2a-server.mjs` artifact.
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

// Execute the a2a-server build. Its output is required by downstream
// release/packaging workflows, so a failure must fail the command.
const a2aResult = await build(a2aServerConfig).catch((error) => error);

// Bun.build() resolves (does not reject) with a result whose `success` flag
// can be false when the build produced diagnostics (unresolved imports, etc.).
// A rejected promise is also possible for hard failures. Both must be treated
// as failures so stale artifacts are never shipped downstream.
const a2aOk =
  !(a2aResult instanceof Error) && a2aResult.success !== false;
if (!a2aOk) {
  if (a2aResult instanceof Error) {
    console.error('a2a-server build failed:', a2aResult);
  } else {
    console.error('a2a-server build completed with errors.');
    const detail = (a2aResult.logs ?? [])
      .map((l) => l.message)
      .join('; ');
    console.warn('a2a-server build logs: ' + (detail || '(none)'));
  }
  process.exit(1);
}

console.log(
  'bun build complete:',
  a2aResult.outputs.map((o) => `${o.path}=${o.size}`),
);
