/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';

// Plugin to replace createRequire imports to avoid conflicts
const createRequirePlugin = {
  name: 'createRequire-plugin',
  setup(build) {
    build.onLoad(
      { filter: /node_modules\/fdir\/dist\/index\.mjs$/ },
      async (args) => {
        const contents = await fs.promises.readFile(args.path, 'utf8');
        // Replace the createRequire import with a reference to the global one
        let transformed = contents
          .replace(
            'import { createRequire } from "module";',
            '// createRequire imported from global',
          )
          .replace(
            'var __require = /* @__PURE__ */ createRequire(import.meta.url);',
            'var __require = /* @__PURE__ */ globalThis.createRequire(import.meta.url);',
          );

        // Also handle any other createRequire patterns that might appear
        // Replace patterns like "/* @__PURE__ */ createRequire" specifically
        transformed = transformed.replace(
          /\/\* @__PURE__ \*\/ createRequire\(import\.meta\.url\)/g,
          '/* @__PURE__ */ globalThis.createRequire(import.meta.url)',
        );

        return { contents: transformed, loader: 'js' };
      },
    );
  },
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pkg = require(path.resolve(__dirname, 'package.json'));

// ESBuild config

esbuild
  .build({
    entryPoints: ['packages/cli/index.ts'],
    bundle: true,
    outfile: 'bundle/llxprt.js',
    platform: 'node',
    format: 'esm',
    plugins: [createRequirePlugin],
    external: [
      '@lydell/node-pty',
      'node-pty',
      '@lydell/node-pty-darwin-arm64',
      '@lydell/node-pty-darwin-x64',
      '@lydell/node-pty-linux-x64',
      '@lydell/node-pty-win32-arm64',
      '@lydell/node-pty-win32-x64',
    ],
    alias: {
      'is-in-ci': path.resolve(
        __dirname,
        'packages/cli/src/patches/is-in-ci.ts',
      ),
    },
    define: {
      'process.env.CLI_VERSION': JSON.stringify(pkg.version),
    },
    banner: {
      js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url); globalThis.__filename = require('url').fileURLToPath(import.meta.url); globalThis.__dirname = require('path').dirname(globalThis.__filename); globalThis.createRequire = createRequire;`,
    },
    loader: { '.node': 'file' },
  })
  .then(() => {
    // ESBuild completed successfully
    fs.chmodSync('bundle/llxprt.js', 0o755);
  })
  .catch((err) => {
    console.error('ESBuild failed:', err);
    process.exit(1);
  });
