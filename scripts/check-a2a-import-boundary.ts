/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI entrypoint for the a2a host import boundary check (issue #3221).
 * The reusable logic lives in ./a2a-boundary/a2aBoundary.ts so tests can
 * exercise the production functions directly.
 */

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanA2aBoundary } from './a2a-boundary/a2aBoundary.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const A2A_DIR = join(REPO_ROOT, 'packages', 'a2a-server');

function main(): void {
  const { violations, fileCount } = scanA2aBoundary(A2A_DIR);
  console.log(`Scanning ${fileCount} a2a-server source files...`);
  if (violations.length > 0) {
    console.log(
      `\nFAIL: ${violations.length} a2a host boundary violation(s):\n`,
    );
    for (const v of violations) {
      console.log(
        `  packages/a2a-server/${v.file}:${v.line} [${v.kind}] ${v.detail}`,
      );
      console.log(`      ${v.reason}`);
    }
    console.log(
      '\na2a-server is an Agent-facade host: only node builtins, relative' +
        ' paths, bun:test, @a2a-js/sdk, runtime package ROOT entrypoints,' +
        ' and declared dependencies may be imported. Legacy runtime-assembly' +
        ' symbols (Config, AgentClient) are banned outright (#3221).',
    );
    process.exit(1);
  }
  console.log('\nA2A import boundary check PASSED.');
  process.exit(0);
}

main();
