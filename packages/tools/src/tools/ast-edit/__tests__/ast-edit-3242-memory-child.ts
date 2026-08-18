/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Child-process fixture for the ast_edit preview/apply memory regression
 * (issue #3242). Invoked by ast-edit-3242-memory.bun.test.ts with a
 * generated workspace directory. Runs the real ASTEditTool against the
 * 5,250-line Rust target: three localized previews (middle, then head and
 * tail in parallel) followed immediately by a force=true apply that reuses
 * the preview timestamp, then verifies the exact bytes landed on disk. RSS
 * is sampled throughout, and a post-result quiet window proves no repository
 * traversal or pending native callback kept allocating after every tool
 * result resolved.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASTEditTool } from '../../ast-edit.js';
import { createAstReadToolHost } from './ast-read-tool-host.js';
import {
  generateRustFixture,
  type RustFixtureEdit,
} from './ast-edit-3242-fixtures.js';

interface MemoryReport {
  readonly ok: boolean;
  readonly previewOk: boolean;
  readonly applyOk: boolean;
  readonly contentApplied: boolean;
  readonly previewBoundedMarker: boolean;
  readonly timestampParsed: boolean;
  readonly peakRssBytes: number;
  readonly finalRssBytes: number;
  readonly postResultRssGrowthBytes: number;
  readonly quietWindowSamples: number;
}

interface ToolOutcome {
  readonly error?: { readonly message: string } | undefined;
  readonly llmContent: string;
}

if (process.argv.length < 3) {
  process.stderr.write(
    'usage: ast-edit-3242-memory-child.ts <workspace-root>\n',
  );
  process.exit(2);
}
const workspaceRoot = process.argv[2];
const fixture = generateRustFixture();
const targetPath = join(workspaceRoot, 'target.rs');

let peakRssBytes = process.memoryUsage.rss();
function sampleRss(): number {
  const rss = process.memoryUsage.rss();
  peakRssBytes = Math.max(peakRssBytes, rss);
  return rss;
}

const sampler = setInterval(() => {
  sampleRss();
}, 20);

async function executePreview(edit: RustFixtureEdit): Promise<ToolOutcome> {
  const tool = new ASTEditTool(createAstReadToolHost(workspaceRoot));
  const result = await tool
    .build({
      file_path: targetPath,
      old_string: edit.oldString,
      new_string: edit.newString,
      force: false,
    })
    .execute(new AbortController().signal);
  // Emit a tool-result marker after every result so the parent can correlate
  // the timing of native fan-out activity (if any survived) with sampling.
  process.stdout.write('AST_EDIT_TOOL_RESULT\n');
  return { error: result.error, llmContent: String(result.llmContent) };
}

const middle = await executePreview(fixture.edits.middle);
const middleOk = middle.error === undefined;
const timestampMatch = /- Timestamp: (\d+)/.exec(middle.llmContent);
const timestampParsed = timestampMatch !== null;
const previewBoundedMarker = middle.llmContent.includes('bounded preview');

const headTail = await Promise.all([
  executePreview(fixture.edits.head),
  executePreview(fixture.edits.tail),
]);
const previewOk =
  middleOk && headTail.every((result) => result.error === undefined);

const applyTool = new ASTEditTool(createAstReadToolHost(workspaceRoot));
const lastModified =
  timestampMatch !== null ? Number(timestampMatch[1]) : undefined;
const applyResult = await applyTool
  .build({
    file_path: targetPath,
    old_string: fixture.edits.middle.oldString,
    new_string: fixture.edits.middle.newString,
    force: true,
    ...(lastModified !== undefined ? { last_modified: lastModified } : {}),
  })
  .execute(new AbortController().signal);
process.stdout.write('AST_EDIT_APPLY_RESULT\n');
const applyOk = applyResult.error === undefined;

const written = readFileSync(targetPath, 'utf-8');
const contentApplied =
  written.includes(fixture.edits.middle.newString) &&
  !written.includes(fixture.edits.middle.oldString);

// Post-result quiet/drain window: sample RSS for a fixed interval after all
// tool results have resolved. The old code's abandoned native findInFiles
// traversals continued past each preview result, so RSS would keep climbing
// here; the opt-out path resolves all its work before returning.
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
  ok: previewOk && applyOk && contentApplied && previewBoundedMarker,
  previewOk,
  applyOk,
  contentApplied,
  previewBoundedMarker,
  timestampParsed,
  peakRssBytes,
  finalRssBytes,
  postResultRssGrowthBytes,
  quietWindowSamples,
};
process.stdout.write('AST_EDIT_QUIET_DONE\n');
process.stdout.write(`AST_EDIT_MEMORY_REPORT ${JSON.stringify(report)}\n`);
