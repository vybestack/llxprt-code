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

// Plugin to remove duplicate createRequire imports
const createRequirePlugin = {
  name: 'createRequire-plugin',
  setup(build) {
    build.onLoad(
      { filter: /node_modules\/fdir\/dist\/index\.mjs$/ },
      async (args) => {
        const contents = await fs.promises.readFile(args.path, 'utf8');
        // Remove duplicate createRequire import - it's already in the banner
        let transformed = contents.replace(
          'import { createRequire } from "module";',
          '// createRequire imported from banner',
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
      js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url); globalThis.__filename = require('url').fileURLToPath(import.meta.url); globalThis.__dirname = require('path').dirname(globalThis.__filename);`,
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
