/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Child-process fixture for the ast_read_file memory regression (issue
 * #3232). Invoked by ast-read-memory.bun.test.ts with a generated workspace
 * directory. Runs the real ASTReadFileTool (one bounded sequential read plus
 * three parallel reads), samples process RSS throughout, and prints a
 * tool-result marker after every invocation, then samples for a quiet
 * window to prove no native traversal or pending callback kept the process
 * alive after all tool results resolved.
 */

import { join } from 'node:path';
import { ASTReadFileTool } from '../../ast-edit.js';
import { createAstReadToolHost } from './ast-read-tool-host.js';

interface MemoryReport {
  readonly ok: boolean;
  readonly sequentialOk: boolean;
  readonly parallelOk: boolean;
  readonly llmHasWorkingSet: boolean;
  readonly peakRssBytes: number;
  readonly finalRssBytes: number;
  readonly postResultRssGrowthBytes: number;
  readonly quietWindowSamples: number;
}

interface ReadOutcome {
  readonly error?: { readonly message: string } | undefined;
  readonly llmContent: string;
}

if (process.argv.length < 3) {
  process.stderr.write('usage: ast-read-memory-child.ts <workspace-root>\n');
  process.exit(2);
}
const workspaceRoot = process.argv[2];

let peakRssBytes = process.memoryUsage.rss();
function sampleRss(): number {
  const rss = process.memoryUsage.rss();
  peakRssBytes = Math.max(peakRssBytes, rss);
  return rss;
}

const sampler = setInterval(() => {
  sampleRss();
}, 20);

async function executeRead(): Promise<ReadOutcome> {
  const tool = new ASTReadFileTool(createAstReadToolHost(workspaceRoot));
  const invocation = tool.build({
    file_path: join(workspaceRoot, 'target.ts'),
    limit: 5,
  });
  const result = await invocation.execute(new AbortController().signal);
  // Emit a tool-result marker after every result so the parent can correlate
  // the timing of native fan-out activity (if any survived) with sampling.
  process.stdout.write('AST_READ_TOOL_RESULT\n');
  return { error: result.error, llmContent: String(result.llmContent) };
}

const sequential = await executeRead();
const sequentialOk = sequential.error === undefined;
const llmHasWorkingSet = sequential.llmContent.includes('WORKING SET CONTEXT');

const parallel = await Promise.all([
  executeRead(),
  executeRead(),
  executeRead(),
]);
const parallelOk = parallel.every((result) => result.error === undefined);

// Post-result quiet/drain window: sample RSS for a fixed interval after all
// tool results have resolved. The old code's native findInFiles fan-out
// continued past each tool result, so RSS would keep climbing here; the
// bounded acquisition resolves all its work before returning, so the tail
// growth stays flat.
const QUIET_WINDOW_MS = 1500;
const SAMPLE_INTERVAL_MS = 25;
const preQuietRss = sampleRss();
let postResultRssGrowthBytes = 0;
let quietWindowSamples = 0;
const quietStart = Date.now();
while (Date.now() - quietStart < QUIET_WINDOW_MS) {
  const rss = sampleRss();
  quietWindowSamples += 1;
  postResultRssGrowthBytes = Math.max(
    postResultRssGrowthBytes,
    rss - preQuietRss,
  );
  await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS));
}

clearInterval(sampler);
const finalRssBytes = process.memoryUsage.rss();
peakRssBytes = Math.max(peakRssBytes, finalRssBytes);

const report: MemoryReport = {
  ok: sequentialOk && parallelOk,
  sequentialOk,
  parallelOk,
  llmHasWorkingSet,
  peakRssBytes,
  finalRssBytes,
  postResultRssGrowthBytes,
  quietWindowSamples,
};
process.stdout.write('AST_READ_QUIET_DONE\n');
process.stdout.write(`AST_READ_MEMORY_REPORT ${JSON.stringify(report)}\n`);
