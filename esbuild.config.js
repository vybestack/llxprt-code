/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';
import fs from 'fs';
import { writeFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pkg = require(path.resolve(__dirname, 'package.json'));

// Try to import esbuild, gracefully handle if not available
let esbuild;
try {
  esbuild = (await import('esbuild')).default;
} catch (error) {
  console.error('Failed to import esbuild:', error);
  process.exit(1);
}

// Plugin to redirect module imports to node:module
const nodeModulePlugin = {
  name: 'node-module-plugin',
  setup(build) {
    build.onResolve({ filter: /^module$/ }, () => ({
      path: 'node:module',
      external: true,
    }));
  },
};

// Shared base configuration
const baseConfig = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  conditions: ['production'], // LLxprt-specific: keep this
  external: [
    '@lydell/node-pty',
    'node-pty',
    '@lydell/node-pty-darwin-arm64',
    '@lydell/node-pty-darwin-x64',
    '@lydell/node-pty-linux-x64',
    '@lydell/node-pty-win32-arm64',
    '@lydell/node-pty-win32-x64',
    'keytar',
    'node:module',
    // UI package uses opentui which has Bun-specific imports that esbuild can't handle
    // Keep it external - it will be dynamically imported at runtime when --experimental-ui is used
    '@vybestack/llxprt-ui',
    '@vybestack/opentui-core',
    '@vybestack/opentui-react',
  ],
  loader: { '.node': 'file' },
  write: true,
};

// CLI-specific configuration
const cliConfig = {
  ...baseConfig,
  entryPoints: ['packages/cli/index.ts'],
  outfile: 'bundle/llxprt.js', // LLxprt branding
  plugins: [nodeModulePlugin], // LLxprt-specific: redirects bare 'module' imports
  alias: {
    'is-in-ci': path.resolve(__dirname, 'packages/cli/src/patches/is-in-ci.ts'),
  },
  define: {
    'process.env.CLI_VERSION': JSON.stringify(pkg.version),
    'process.env.NODE_ENV': '"production"', // LLxprt-specific: production mode
  },
  banner: {
    js: `import * as nodeModule from 'node:module'; const require = nodeModule.createRequire(import.meta.url); globalThis.__filename = require('url').fileURLToPath(import.meta.url); globalThis.__dirname = require('path').dirname(globalThis.__filename);`,
  },
  metafile: true, // For bundle analysis in DEV mode
  minify: true, // LLxprt-specific: minification
};

// a2a-server-specific configuration
const a2aServerConfig = {
  ...baseConfig,
  entryPoints: ['packages/a2a-server/src/http/server.ts'],
  outfile: 'packages/a2a-server/dist/a2a-server.mjs',
  // NO nodeModulePlugin - a2a-server doesn't import bare 'module'
  // NO metafile - not needed for secondary build
  banner: {
    // Different banner pattern - uses top-level await with dynamic import
    js: `const require = (await import('module')).createRequire(import.meta.url); globalThis.__filename = require('url').fileURLToPath(import.meta.url); globalThis.__dirname = require('path').dirname(globalThis.__filename);`,
  },
  define: {
    'process.env.CLI_VERSION': JSON.stringify(pkg.version),
    'process.env.NODE_ENV': '"production"',
  },
  minify: true, // LLxprt-specific: minification
};

// Execute both builds in parallel
Promise.allSettled([
  esbuild.build(cliConfig).then((result) => {
    // chmod must run INSIDE the CLI build's .then() handler
    // This ensures it runs after build completes but before allSettled resolution
    fs.chmodSync('bundle/llxprt.js', 0o755);

    // Write metafile for bundle analysis in DEV mode
    if (process.env.DEV === 'true' && result.metafile) {
      writeFileSync(
        './bundle/esbuild.json',
        JSON.stringify(result.metafile, null, 2),
      );
    }

    return result;
  }),
  esbuild.build(a2aServerConfig),
]).then((results) => {
  const [cliResult, a2aResult] = results;

  // CLI build failure is FATAL - must exit
  if (cliResult.status === 'rejected') {
    console.error('llxprt.js build failed:', cliResult.reason);
    process.exit(1);
  }

  // a2a-server build failure is NON-FATAL - warn only
  // This allows CLI bundle to succeed even if a2a-server fails
  if (a2aResult.status === 'rejected') {
    console.warn('a2a-server build failed:', a2aResult.reason);
  }

  // No .catch() needed - Promise.allSettled never rejects
});
