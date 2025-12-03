/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Copies tiktoken WASM next to the bundled extension so runtime can load it.
 * tiktoken's loader searches alongside __dirname first, so we place it in dist/.
 *
 * @type {import('esbuild').Plugin}
 */
const copyTiktokenWasmPlugin = {
  name: 'copy-tiktoken-wasm',
  async setup(build) {
    const targetPath = path.join(__dirname, 'dist', 'tiktoken_bg.wasm');
    let sourcePath;
    try {
      sourcePath = require.resolve('@dqbd/tiktoken/tiktoken_bg.wasm');
    } catch (err) {
      console.warn(
        '[copy-tiktoken-wasm] Unable to locate tiktoken_bg.wasm:',
        err,
      );
      return;
    }

    const copy = async () => {
      try {
        await fs.cp(sourcePath, targetPath);
      } catch (err) {
        console.warn('[copy-tiktoken-wasm] Failed to copy wasm:', err);
      }
    };

    build.onEnd(copy);
  },
};

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(
          `    ${location.file}:${location.line}:${location.column}:`,
        );
      });
      console.log('[watch] build finished');
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.cjs',
    external: ['vscode'],
    logLevel: 'silent',
    banner: {
      js: `const import_meta = { url: require('url').pathToFileURL(__filename).href };`,
    },
    define: {
      'import.meta.url': 'import_meta.url',
    },
    plugins: [
      copyTiktokenWasmPlugin,
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
    loader: { '.node': 'file' },
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
