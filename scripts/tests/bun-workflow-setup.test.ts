/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const NL = '\n';

interface PackageJson {
  scripts?: Record<string, string>;
}

function readRootPackageJson(): PackageJson {
  return JSON.parse(
    readFileSync(resolve(repoRoot, 'package.json'), 'utf-8'),
  ) as PackageJson;
}

const rootPkg = readRootPackageJson();

function relativeToRepo(p: string): string {
  const prefix = repoRoot + sep;
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unquoteToken(token: string): string {
  if (token.length < 2) return token;
  const first = token[0];
  const last = token[token.length - 1];
  return (first === '"' || first === "'") && first === last
    ? token.slice(1, -1)
    : token;
}

function isEnoent(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return (error as Record<string, unknown>).code === 'ENOENT';
}

describe('Issue #2242: workflow jobs running Bun-backed npm scripts set up Bun', () => {
  function commandReferencesScript(command: string, key: string): boolean {
    const escapedKey = escapeRegExp(key);
    return new RegExp(
      `npm\\s+(?:run|run-script)\\s+${escapedKey}(?![-:\\w])`,
    ).test(command);
  }

  function bunBackedScriptKeys(): ReadonlySet<string> {
    const scripts = Object.entries(rootPkg.scripts ?? {});
    const bunBacked = new Set(
      scripts
        .filter(([, command]) => isDirectBunScriptCommand(command))
        .map(([key]) => key),
    );
    let changed = true;
    while (changed) {
      changed = false;
      for (const [key, command] of scripts) {
        if (bunBacked.has(key)) continue;
        if (
          [...bunBacked].some((backedKey) =>
            commandReferencesScript(command, backedKey),
          )
        ) {
          bunBacked.add(key);
          changed = true;
        }
      }
    }
    return bunBacked;
  }

  const BUN_BACKED_SCRIPT_KEYS: ReadonlySet<string> = bunBackedScriptKeys();

  /**
   * Workflow directory to scan.
   */
  const WORKFLOWS_DIR = join(repoRoot, '.github', 'workflows');

  /**
   * Matches a top-level `  <job-name>:` job header (two-space indent under
   * the `jobs:` key). Capture group 1 is the job name.
   */
  const JOB_HEADER = /^ {2}([A-Za-z0-9_-]+):/gm;

  /**
   * Reads every workflow file as a map of job-name to job-block text.
   * Returns an empty map when the directory is absent.
   */
  function readWorkflowJobs(
    file: string,
  ): Array<{ readonly name: string; readonly body: string }> {
    const text = readFileSync(file, 'utf-8');
    const jobsIndex = text.search(/^jobs:/m);
    if (jobsIndex === -1) return [];
    const afterJobs = text.slice(jobsIndex);
    const headers: Array<{ readonly name: string; readonly index: number }> =
      [];
    let match: RegExpExecArray | null;
    JOB_HEADER.lastIndex = 0;
    while ((match = JOB_HEADER.exec(afterJobs)) !== null) {
      headers.push({ name: match[1], index: match.index });
    }
    const jobs: Array<{ readonly name: string; readonly body: string }> = [];
    for (let i = 0; i < headers.length; i++) {
      const start = headers[i].index;
      const end =
        i + 1 < headers.length ? headers[i + 1].index : afterJobs.length;
      jobs.push({
        name: headers[i].name,
        body: afterJobs.slice(start, end),
      });
    }
    return jobs;
  }

  function readWorkflowDirEntries(): ReturnType<typeof readdirSync> | null {
    try {
      return readdirSync(WORKFLOWS_DIR, { withFileTypes: true });
    } catch (error) {
      if (!isEnoent(error)) throw error;
      return null;
    }
  }

  /**
   * Collects workflow file paths under .github/workflows.
   */
  function collectWorkflowFiles(): string[] {
    const entries = readWorkflowDirEntries();
    if (entries === null) {
      return [];
    }
    return entries
      .filter(
        (entry) =>
          entry.isFile() &&
          (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')),
      )
      .map((entry) => join(WORKFLOWS_DIR, entry.name))
      .sort();
  }

  const SHELL_COMMAND_BOUNDARY = '(?:^|(?:&&|\\|\\||;|\\||\\(|\\)|`|=|>)\\s*)';
  const npmScriptRegexes = new Map(
    [...BUN_BACKED_SCRIPT_KEYS].map((key) => {
      const escapedKey = escapeRegExp(key);
      const npmRun = `npm\\s+(?:run|run-script)\\s+${escapedKey}(?![-:\\w])`;
      return [key, new RegExp(SHELL_COMMAND_BOUNDARY + npmRun)] as const;
    }),
  );

  function shellCommandRunsNpmScript(command: string, key: string): boolean {
    return npmScriptRegexes.get(key)?.test(command) ?? false;
  }

  // npm ci with --ignore-scripts skips lifecycle hooks, so it does not need Bun
  // available before that specific install command.
  const npmCiRe = new RegExp(
    `${SHELL_COMMAND_BOUNDARY}npm\\s+ci(?![-:\\w])(?![^\n]*--ignore-scripts)`,
  );

  function shellCommandRunsNpmCi(command: string): boolean {
    return npmCiRe.test(command);
  }

  interface RunCommandEntry {
    readonly command: string;
    readonly offset: number;
  }

  /**
   * Extracts a single-line `run:` command into the command list. Empty
   * block-scalar openers are ignored here and handled by multiline parsing.
   */
  function appendRunCommand(
    commands: RunCommandEntry[],
    line: string,
    offset: number,
  ): void {
    const command = commandFromRunLine(line);
    if (command !== undefined) {
      commands.push({ command, offset });
    }
  }

  function collectMultilineCommand(
    commands: RunCommandEntry[],
    line: string,
    runOffset: number,
    contentIndent: number,
  ): boolean {
    const blockCommand = commandFromMultilineLine(line, contentIndent);
    if (blockCommand !== undefined) {
      commands.push({ command: blockCommand, offset: runOffset });
    }
    return !shouldEndMultilineBlock(line, blockCommand, contentIndent);
  }

  function multilineContentIndent(
    lines: readonly string[],
    lineIndex: number,
  ): number {
    for (let index = lineIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trimStart();
      if (trimmed !== '' && !trimmed.startsWith('#')) {
        return line.length - trimmed.length;
      }
    }
    const line = lines[lineIndex];
    return line.length - line.trimStart().length + 2;
  }

  function workflowRunCommandEntries(body: string): RunCommandEntry[] {
    const commands: RunCommandEntry[] = [];
    let offset = 0;
    let insideMultiline = false;
    let blockRunOffset = 0;
    let blockContentIndent = 0;
    const lines = body.split('\n');
    for (const [lineIndex, line] of lines.entries()) {
      if (insideMultiline) {
        insideMultiline = collectMultilineCommand(
          commands,
          line,
          blockRunOffset,
          blockContentIndent,
        );
        if (!insideMultiline) {
          appendRunCommand(commands, line, offset);
        }
      } else {
        appendRunCommand(commands, line, offset);
      }
      // A line that closes one multiline block can also be a `run: |-` opener
      // for the next step; commandFromRunLine deliberately returns undefined
      // for block-scalar openers so this transition is not double-counted.
      if (!insideMultiline && runLineOpensMultilineBlock(line)) {
        insideMultiline = true;
        blockRunOffset = offset;
        blockContentIndent = multilineContentIndent(lines, lineIndex);
      }
      offset += line.length + 1;
    }
    return commands;
  }

  function workflowRunCommands(body: string): string[] {
    return workflowRunCommandEntries(body).map((entry) => entry.command);
  }

  function bunBackedScriptsInCommands(commands: readonly string[]): string[] {
    const hits: string[] = [];
    for (const key of BUN_BACKED_SCRIPT_KEYS) {
      const found = commands.some((command) =>
        shellCommandRunsNpmScript(command, key),
      );
      if (found) {
        hits.push(key);
      }
    }
    return hits;
  }

  function isDirectBunScriptCommand(command: string): boolean {
    const trimmed = command.trimStart();
    if (trimmed.startsWith('#')) return false;
    const shellNormalized = trimmed
      .replaceAll('$(', ' ')
      .replaceAll('`', ' ')
      .replaceAll('(', ' ')
      .replaceAll(')', ' ')
      .replaceAll('=', ' ');
    return shellNormalized.split(/[;&|]+/).some((segment) => {
      const tokens = segment.trim().split(/\s+/).filter(Boolean);
      const bunIndex = tokens.findIndex(
        (token) => unquoteToken(token) === 'bun',
      );
      return (
        bunIndex >= 0 &&
        tokens.slice(bunIndex + 1).some((token) => token.includes('scripts/'))
      );
    });
  }

  function buildBunReasons(
    invoked: readonly string[],
    directBunCall: boolean,
  ): string[] {
    const reasons: string[] = [];
    if (invoked.length > 0) {
      reasons.push(`bun-backed [${invoked.join(', ')}]`);
    }
    if (directBunCall) {
      reasons.push('direct bun scripts/ call');
    }
    return reasons;
  }
  it('package.json contains Bun-backed scripts for workflow guards', () => {
    expect(
      BUN_BACKED_SCRIPT_KEYS.size,
      'Expected at least one Bun-backed npm script in package.json.',
    ).toBeGreaterThan(0);
  });

  it('every job running a Bun-backed npm script also sets up Bun', () => {
    const offenders: string[] = [];
    function jobHasActiveSetupBun(body: string): boolean {
      return (
        firstLineOffset(body, (line) => {
          const trimmed = line.trimStart();
          return (
            !trimmed.startsWith('#') &&
            trimmed.startsWith('uses:') &&
            trimmed.includes('oven-sh/setup-bun')
          );
        }) !== -1
      );
    }

    for (const file of collectWorkflowFiles()) {
      const rel = relativeToRepo(file);
      for (const job of readWorkflowJobs(file)) {
        const commands = workflowRunCommands(job.body);
        const invoked = bunBackedScriptsInCommands(commands);
        const directBunCall = commands.some((command) =>
          isDirectBunScriptCommand(command),
        );
        // Skip jobs that neither run a Bun-backed npm script nor call
        // bun scripts/ directly, AND jobs that do but already set up Bun.
        const needsBun = invoked.length > 0 || directBunCall;
        if (!needsBun || jobHasActiveSetupBun(job.body)) continue;
        const reasons = buildBunReasons(invoked, directBunCall);
        offenders.push(
          `${rel} :: ${job.name} runs ${reasons.join(' + ')} without oven-sh/setup-bun`,
        );
      }
    }

    const message =
      'Workflow jobs run Bun-backed npm scripts without setting up Bun:' +
      NL +
      offenders.join(NL);
    expect(offenders, message).toEqual([]);
  });

  function normalizeRunLine(line: string): string {
    return line.trimStart().replace(/^-\s+/, '');
  }

  // Returns undefined when the run payload is not a block scalar; returns the
  // possibly-empty inline payload that follows a | or > block scalar indicator.
  function payloadAfterBlockScalarIndicator(
    payload: string,
  ): string | undefined {
    const first = payload[0];
    if (first !== '|' && first !== '>') return undefined;
    let index = 1;
    if (payload[index] === '-' || payload[index] === '+') {
      index += 1;
    }
    while (index < payload.length && /\d/.test(payload[index])) {
      index += 1;
    }
    return payload.slice(index).trimStart();
  }

  function commandFromRunLine(line: string): string | undefined {
    const normalized = normalizeRunLine(line);
    if (!normalized.startsWith('run:')) return undefined;
    let payload = normalized.slice('run:'.length).trimStart();
    const blockScalarPayload = payloadAfterBlockScalarIndicator(payload);
    if (blockScalarPayload !== undefined) {
      payload = blockScalarPayload;
    }
    if (payload === '') return undefined;
    const quote = payload[0];
    const lastChar = payload[payload.length - 1];
    if ((quote === "'" || quote === '"') && lastChar === quote) {
      payload = payload.slice(1, -1);
    }
    const command = payload.trimStart();
    return command === '' ? undefined : command;
  }

  function runLineOpensMultilineBlock(line: string): boolean {
    const normalized = normalizeRunLine(line);
    if (!normalized.startsWith('run:')) return false;
    const afterRun = normalized.slice('run:'.length).trimStart();
    return /^[|>][-+]?\d*\s*$/.test(afterRun);
  }

  function commandFromMultilineLine(
    line: string,
    contentIndent: number,
  ): string | undefined {
    const indent = line.length - line.trimStart().length;
    if (indent < contentIndent || line.trimStart() === '') {
      return undefined;
    }
    const payload = line.trimStart();
    if (payload.startsWith('#')) return undefined;
    return payload === '' ? undefined : payload;
  }

  function shouldEndMultilineBlock(
    line: string,
    blockCommand: string | undefined,
    contentIndent: number,
  ): boolean {
    if (blockCommand !== undefined || line.trim() === '') return false;
    const indent = line.length - line.trimStart().length;
    return indent < contentIndent;
  }

  function npmCiRunStepOffset(body: string): number | undefined {
    return workflowRunCommandEntries(body).find((entry) =>
      shellCommandRunsNpmCi(entry.command),
    )?.offset;
  }

  function firstLineOffset(
    body: string,
    predicate: (line: string) => boolean,
  ): number {
    let offset = 0;
    for (const line of body.split('\n')) {
      if (predicate(line)) {
        return offset;
      }
      offset += line.length + 1;
    }
    return -1;
  }

  it('setup-bun runs before npm ci in jobs where lifecycle scripts can invoke Bun', () => {
    const offenders: string[] = [];
    for (const file of collectWorkflowFiles()) {
      const rel = relativeToRepo(file);
      for (const job of readWorkflowJobs(file)) {
        const setupBunIdx = firstLineOffset(job.body, (line) => {
          const trimmed = line.trimStart();
          return (
            !trimmed.startsWith('#') &&
            trimmed.startsWith('uses:') &&
            trimmed.includes('oven-sh/setup-bun')
          );
        });
        const npmCiIdx = npmCiRunStepOffset(job.body);
        if (npmCiIdx === undefined) {
          continue;
        }
        if (setupBunIdx === -1) {
          offenders.push(
            `${rel} :: ${job.name} runs npm ci without oven-sh/setup-bun; ` +
              'lifecycle hooks (postinstall) can invoke Bun-backed scripts ' +
              'during npm ci, so setup-bun must run first',
          );
        } else if (setupBunIdx > npmCiIdx) {
          offenders.push(
            `${rel} :: ${job.name} runs oven-sh/setup-bun AFTER the npm ci ` +
              `step (setup-bun at offset ${setupBunIdx}, npm ci at ${npmCiIdx}); ` +
              'lifecycle hooks (postinstall) can invoke Bun-backed scripts ' +
              'during npm ci, so setup-bun must come first',
          );
        }
      }
    }

    const message =
      'Workflow jobs set up Bun AFTER npm ci (lifecycle scripts can invoke ' +
      'Bun-backed build/bundle scripts during npm ci):' +
      NL +
      offenders.join(NL);
    expect(offenders, message).toEqual([]);
  });
});
