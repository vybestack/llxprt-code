/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pkg = require(path.resolve(__dirname, 'package.json'));

console.log('ESBuild config:');
console.log('  __dirname:', __dirname);
console.log('  outfile:', path.resolve(__dirname, 'bundle/llxprt.js'));

esbuild
  .build({
    entryPoints: ['packages/cli/index.ts'],
    bundle: true,
    outfile: 'bundle/llxprt.js',
    platform: 'node',
    format: 'esm',
    external: [],
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
  })
  .then(() => {
    const bundlePath = path.resolve(__dirname, 'bundle/llxprt.js');
    console.log('ESBuild completed:');
    console.log('  Bundle path:', bundlePath);
    console.log('  Bundle exists:', fs.existsSync(bundlePath));
    console.log(
      '  Bundle size:',
      fs.existsSync(bundlePath) ? fs.statSync(bundlePath).size : 'N/A',
    );

    // List bundle directory contents
    const bundleDir = path.dirname(bundlePath);
    if (fs.existsSync(bundleDir)) {
      const files = fs.readdirSync(bundleDir);
      console.log(`  Bundle dir contents (${files.length} items):`, files);
    }

    fs.chmodSync('bundle/llxprt.js', 0o755);
  })
  .catch((err) => {
    console.error('ESBuild failed:', err);
    process.exit(1);
  });
