/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, describe, it } from 'bun:test';
import { build } from 'bun';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..', '..', '..');
const shellParserPath = join(__dirname, 'shell-parser.ts');

interface NodeExecError extends Error {
  status?: number | null;
  stderr?: string | Buffer;
  stdout?: string | Buffer;
}

function isNodeExecError(value: unknown): value is NodeExecError {
  return value instanceof Error;
}

function bufferToText(value: string | Buffer | undefined): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Buffer) {
    return value.toString('utf8');
  }
  return '';
}

/**
 * Out-of-process Node smoke of the **production** shell-parser module (#3181).
 *
 * The test uses `Bun.build` to bundle `shell-parser.ts` (the actual production
 * code, not hand-written web-tree-sitter loading) into a temporary ESM module
 * targeting Node. `web-tree-sitter` is externalized so Node resolves it from
 * `node_modules`; every relative import (DebugLogger, runtime, etc.) is bundled
 * inline.
 *
 * The spawned Node process:
 * 1. Imports the bundled production shell-parser.
 * 2. Calls `initializeParser()`.
 * 3. Asserts Bash is available and PowerShell is unavailable.
 * 4. Exits cleanly.
 *
 * If the production code accidentally loaded the PowerShell grammar under Node
 * (e.g., the `isBunRuntime()` guard regressed), the process would crash at
 * shutdown with a V8 "Zone" out-of-memory error (observed under Node 24),
 * causing `execFileSync` to throw. The explicit `pwshAvailable: false` assertion
 * is a belt-and-suspenders check.
 */
describe('shell-parser: Node production smoke', () => {
  it('Node loads production shell-parser: Bash available, PowerShell unavailable, clean exit', async () => {
    // Temp dir inside the workspace so Node module resolution walks up to
    // find node_modules (web-tree-sitter and grammar WASM files).
    const tmpParent = join(repoRoot, 'tmp');
    mkdirSync(tmpParent, { recursive: true });
    const tempDir = mkdtempSync(join(tmpParent, 'node-prod-smoke-'));
    const wrapperPath = join(tempDir, 'entry.ts');
    const outPath = join(tempDir, 'entry.js');

    try {
      // Wrapper that exercises the REAL production shell-parser module.
      writeFileSync(
        wrapperPath,
        `import {
  initializeParser,
  isParserAvailable,
  resetParser,
} from ${JSON.stringify(shellParserPath)};

const ok = await initializeParser();
const result = {
  initOk: ok,
  bashAvailable: isParserAvailable('bash'),
  pwshAvailable: isParserAvailable('powershell'),
};
resetParser();
console.log(JSON.stringify(result));
`,
      );

      // Bundle the wrapper + production shell-parser + all relative deps.
      // Externalize web-tree-sitter so Node resolves it from node_modules;
      // everything else (DebugLogger, runtime.ts, etc.) is bundled inline.
      const buildResult = await build({
        entrypoints: [wrapperPath],
        outdir: tempDir,
        target: 'node',
        format: 'esm',
        external: ['web-tree-sitter'],
      });

      if (!buildResult.success) {
        throw new Error(
          'Bun.build failed: ' +
            buildResult.logs.map((l) => String(l)).join('; '),
        );
      }

      // Explicit output-file existence check: verify Bun.build actually
      // emitted the entry point before spawning Node (#3181 OCR).
      if (!existsSync(outPath)) {
        throw new Error(
          `Bun.build reported success but output file was not created: ${outPath}`,
        );
      }

      // Spawn Node to run the bundled production code.
      try {
        const stdout = execFileSync('node', [outPath], {
          cwd: tempDir,
          encoding: 'utf8',
          timeout: 30_000,
          env: { ...process.env },
        });

        const result = JSON.parse(stdout.trim()) as {
          initOk: boolean;
          bashAvailable: boolean;
          pwshAvailable: boolean;
        };

        // Bash grammar must load and be available under Node.
        expect(result.initOk).toBe(true);
        expect(result.bashAvailable).toBe(true);
        // PowerShell grammar must NOT be loaded under Node (isBunRuntime guard).
        expect(result.pwshAvailable).toBe(false);
      } catch (error: unknown) {
        const status = isNodeExecError(error) ? error.status : undefined;
        const stderrText = isNodeExecError(error)
          ? bufferToText(error.stderr)
          : '';
        const stdoutText = isNodeExecError(error)
          ? bufferToText(error.stdout)
          : '';
        const messageText = isNodeExecError(error) ? error.message : '';
        const parts = [stderrText, stdoutText, messageText];
        const detail = parts.find((p): p is string => !!p && p.length > 0);
        throw new Error(
          `Node production smoke failed (exit ${status ?? 'unknown'}): ` +
            `${detail ?? String(error)}`,
        );
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 60_000);
});
