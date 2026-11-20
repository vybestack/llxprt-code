/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { withTestNamedWriters } from '../../packages/core/src/journal/__tests__/support/namedWriterOwner.js';
import { JournalRecordingService } from '../../packages/core/src/recording/journalRecordingService.js';
import type { RefusalPayload } from '../../packages/core/src/recording/refusalPayload.js';
import type { RefusalRewritePayload } from '../../packages/core/src/recording/refusalRewritePayload.js';
import type {
  ContentBlock,
  IContent,
} from '../../packages/core/src/services/history/IContent.js';

const tempDirs: string[] = [];
const services: JournalRecordingService[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
  for (const dir of tempDirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Fixture times are offsets from a base later than the moment each journal
 * session starts: a session's start time is its real creation time, and
 * real rows and audits are always recorded after it.
 */
const BASE = Date.now() + 10 * 60_000;
const at = (offsetMs: number): string =>
  new Date(BASE + offsetMs).toISOString();

type SessionRow = {
  readonly at: number;
  readonly speaker: IContent['speaker'];
  readonly blocks: ContentBlock[];
  readonly summaryAuthor?: {
    readonly provider: string;
    readonly model: string;
  };
};

type JournalSessionFixture = {
  readonly sessionId: string;
  readonly cwd?: string;
  readonly workspaceDirs?: string[];
  readonly rows?: readonly SessionRow[];
  readonly refusals?: readonly RefusalPayload[];
  readonly rewrites?: readonly RefusalRewritePayload[];
};

function contentRow(row: SessionRow, seq: number): IContent {
  const metadata: NonNullable<IContent['metadata']> = {
    chronology: { seq, userTurn: 1, step: seq, recordedAt: BASE + row.at },
  };
  if (row.summaryAuthor !== undefined) {
    metadata.isSummary = true;
    metadata.compressionProvenance = {
      summaryAuthorModel: row.summaryAuthor.model,
      summaryAuthorProvider: row.summaryAuthor.provider,
      compressionStrategy: 'one-shot',
    };
  }
  return { speaker: row.speaker, blocks: row.blocks, metadata };
}

/** Records one real journal session under `<project>/chats`. */
async function recordJournalSession(
  project: string,
  fixture: JournalSessionFixture,
): Promise<void> {
  const service = JournalRecordingService.create(
    withTestNamedWriters({
      sessionId: fixture.sessionId,
      projectHash: path.basename(project),
      chatsDir: path.join(project, 'chats'),
      workspaceDirs: fixture.workspaceDirs ?? [],
      ...(fixture.cwd === undefined ? {} : { cwd: fixture.cwd }),
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    }),
  );
  services.push(service);
  const session = await service.session();
  const rows = fixture.rows ?? [];
  if (rows.length > 0)
    await session.append(rows.map((row, index) => contentRow(row, index + 1)));
  for (const refusal of fixture.refusals ?? []) service.recordRefusal(refusal);
  await service.flush();
  for (const rewrite of fixture.rewrites ?? []) {
    const value = new TextEncoder().encode(JSON.stringify(rewrite));
    await session.store.commit([
      {
        kind: 'prepared',
        admission: [],
        prepare: (group) =>
          group.retainMetadata(
            `refusal_rewrite:${rewrite.operationId}`,
            value,
            'body',
          ),
      },
    ]);
  }
  await service.dispose();
  services.splice(services.indexOf(service), 1);
}

function refusal(
  promptId: string,
  attemptIndex: number,
  offsetMs: number,
  extra: Partial<RefusalPayload>,
): RefusalPayload {
  return {
    time: at(offsetMs),
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    promptId,
    turnId: null,
    attemptIndex,
    finishReason: 'refusal',
    action: 'retry',
    ...extra,
  };
}

const text = (value: string): ContentBlock[] => [{ type: 'text', text: value }];
function partialOutput(value: string): RefusalPayload['partial_output'] {
  const bytes = Buffer.byteLength(value);
  return {
    items: [
      { type: 'text', text: value, original_bytes: bytes, truncated: false },
    ],
    truncated: false,
    original_bytes: bytes,
    preview_bytes: bytes,
  };
}
const summaryText = text('<state_snapshot>summary</state_snapshot>');
const summaryAuthor = { provider: 'anthropic', model: 'claude-summary' };

function fixtureRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-survey-'));
  tempDirs.push(dir);
  return dir;
}

function writeJsonLines(file: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
  );
}

function runSurvey(
  root: string,
  args: string[] = [],
): { stdout: string; stderr: string } {
  const result = Bun.spawnSync(
    [
      process.execPath,
      'scripts/refusal-survey.ts',
      '--root',
      root,
      '--json',
      '-',
      ...args,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LLXPRT_LOG_HOME: path.dirname(path.dirname(root)),
        LLXPRT_CACHE_HOME: path.dirname(path.dirname(root)),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  if (result.exitCode !== 0)
    throw new Error(
      `survey exited ${result.exitCode}: ${result.stderr.toString()}`,
    );
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe('refusal survey CLI', () => {
  it('parses #4068 summary turn records with refusal evidence', () => {
    const root = path.join(fixtureRoot(), 'logs', 'tmp');
    const project = path.join(root, 'summary-format');
    writeJsonLines(path.join(project, 'token-usage', 'usage.jsonl'), [
      {
        record_type: 'turn',
        schema_version: 1,
        ts: '2026-11-02T10:00:00Z',
        session_id: 'summary-session',
        turn_id: 'turn-1',
        runtime_id: 'runtime-1',
        parent_runtime_id: null,
        subagent_name: null,
        prompt_id: 'summary-prompt',
        attempt_index: 0,
        attempt_outcome: 'refusal',
        finish_reason: 'refusal',
        raw_stop_reason: 'refusal',
        refusal_category: 'policy',
        refusal_explanation: 'Request blocked',
        recommended_model: 'claude-sonnet-5',
        request_id: 'req-summary-1',
        dump_base_id: 'dump-summary-1',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        protocol: 'anthropic',
        actual_prompt_tokens: 1200,
        cached_tokens: 0,
        output_tokens: 0,
        estimated_tokens: 1200,
        estimator_family: 'anthropic-char',
        stateful_parent_used: false,
        fixed_tokens: 100,
        new_tool_result_count: 0,
        new_tool_result_tokens: 0,
        carried_tool_result_tokens: 0,
      },
      {
        record_type: 'turn',
        ts: '2026-11-02T10:00:01Z',
        session_id: 'summary-session',
        runtime_id: 'runtime-1',
        prompt_id: 'summary-prompt',
        attempt_index: 1,
        attempt_outcome: 'error',
        finish_reason: 'error',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
      },
    ]);

    const { stdout } = runSurvey(root);
    const report = JSON.parse(stdout) as {
      runs: Array<{
        category: string | null;
        refusalAttempts: number;
        recovery: string;
      }>;
    };
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({
      category: 'policy',
      refusalAttempts: 1,
      recovery: 'none',
    });
  });

  it('does not count errored, aborted, or abandoned attempts as recovery', () => {
    const root = path.join(fixtureRoot(), 'logs', 'tmp');
    const outcomes = ['error', 'aborted', 'abandoned'] as const;
    for (const [index, outcome] of outcomes.entries()) {
      const project = path.join(root, `outcome-${outcome}`);
      const sessionId = `session-${outcome}`;
      const promptId = `prompt-${outcome}`;
      writeJsonLines(path.join(project, 'token-usage', 'usage.jsonl'), [
        {
          record_type: 'turn',
          ts: '2026-11-02T10:00:00Z',
          session_id: sessionId,
          runtime_id: `runtime-${index}`,
          prompt_id: promptId,
          attempt_index: 0,
          attempt_outcome: 'refusal',
          finish_reason: 'refusal',
          provider: 'anthropic',
          model: 'claude-opus-5-5',
        },
        {
          record_type: 'turn',
          ts: '2026-11-02T10:00:01Z',
          session_id: sessionId,
          runtime_id: `runtime-${index}`,
          prompt_id: promptId,
          attempt_index: 1,
          attempt_outcome: outcome,
          finish_reason: 'error',
          provider: 'anthropic',
          model: 'claude-opus-5-5',
        },
      ]);
    }

    const { stdout } = runSurvey(root);
    const report = JSON.parse(stdout) as {
      runs: Array<{ recovery: string }>;
    };
    expect(report.runs).toHaveLength(outcomes.length);
    expect(report.runs.map((run) => run.recovery)).toEqual([
      'none',
      'none',
      'none',
    ]);
  });

  it('joins legacy token usage by prompt prefix when session ids differ', async () => {
    const root = path.join(fixtureRoot(), 'logs', 'tmp');
    const project = path.join(root, 'legacy-prefix');
    writeJsonLines(path.join(project, 'token-usage', 'usage-id.jsonl'), [
      {
        ts: at(0),
        prompt_id: 'legacy-session-uuid-prompt-1',
        session_id: 'usage-file-id',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        attempt_outcome: 'refusal',
        attempt_index: 0,
      },
    ]);
    await recordJournalSession(project, {
      sessionId: 'legacy-session-uuid',
      workspaceDirs: ['/legacy'],
      rows: [
        { at: -300, speaker: 'human', blocks: summaryText, summaryAuthor },
      ],
    });
    const output = runSurvey(root);
    const report = JSON.parse(output.stdout) as {
      runs: Array<Record<string, unknown>>;
      summary: {
        compression: Record<string, { refusals: number; attempts: number }>;
        joins: Record<string, number>;
      };
    };
    expect(report.runs[0]?.['join']).toBe('legacy-prompt-prefix');
    expect(report.summary.joins['legacy-prompt-prefix']).toBe(1);
    expect(report.summary.compression['after-compression']).toMatchObject({
      refusals: 1,
      attempts: 1,
    });
  });

  it('uses a unique timestamp-covering journal when prompt prefixes are ambiguous', async () => {
    const root = path.join(fixtureRoot(), 'logs', 'tmp');
    const project = path.join(root, 'legacy-time');
    writeJsonLines(path.join(project, 'token-usage', 'usage.jsonl'), [
      {
        ts: at(0),
        prompt_id: 'legacy-session-prompt',
        session_id: 'different-usage-id',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        attempt_outcome: 'refusal',
        attempt_index: 0,
      },
    ]);
    // Both session ids prefix the prompt id; only the second session's
    // recorded span reaches the refused call.
    await recordJournalSession(project, {
      sessionId: 'legacy',
      rows: [
        { at: -40_000, speaker: 'human', blocks: summaryText, summaryAuthor },
      ],
    });
    await recordJournalSession(project, {
      sessionId: 'legacy-session',
      rows: [{ at: 0, speaker: 'human', blocks: summaryText, summaryAuthor }],
    });
    const output = runSurvey(root);
    const report = JSON.parse(output.stdout) as {
      runs: Array<Record<string, unknown>>;
      summary: {
        compression: Record<string, { refusals: number; attempts: number }>;
        joins: Record<string, number>;
      };
    };
    expect(report.runs[0]?.['join']).toBe('legacy-timestamp');
    expect(report.summary.joins['legacy-timestamp']).toBe(1);
    expect(report.summary.compression['after-compression']).toMatchObject({
      refusals: 1,
      attempts: 1,
    });
  });

  it('does not join a child session to its parent compression history', async () => {
    const root = path.join(fixtureRoot(), 'logs', 'tmp');
    const project = path.join(root, 'project-isolation');
    writeJsonLines(path.join(project, 'token-usage', 'child.jsonl'), [
      {
        ts: at(0),
        prompt_id: 'same-prompt',
        session_id: 'parent::child',
        runtime_id: 'child-runtime',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        output_tokens: 0,
        attempt_outcome: 'refusal',
        attempt_index: 0,
      },
    ]);
    await recordJournalSession(project, {
      sessionId: 'parent',
      workspaceDirs: ['/project'],
      rows: [
        {
          at: -20_000,
          speaker: 'human',
          blocks: summaryText,
          summaryAuthor: { provider: 'anthropic', model: 'parent-summary' },
        },
      ],
    });
    await recordJournalSession(project, {
      sessionId: 'parent::child',
      workspaceDirs: ['/project'],
    });

    const output = runSurvey(root);
    const report = JSON.parse(output.stdout) as {
      summary: {
        compression: Record<string, { refusals: number; attempts: number }>;
      };
    };

    expect(report.summary.compression['missing-evidence']).toMatchObject({
      refusals: 1,
      attempts: 1,
    });
    expect(report.summary.compression['after-compression']).toMatchObject({
      refusals: 0,
      attempts: 0,
    });
  });

  it('groups refusal attempts and correlates compression, recovery, dumps and categories', async () => {
    const root = path.join(fixtureRoot(), 'logs', 'tmp');
    const project = path.join(root, 'project-alpha');
    const usage = path.join(project, 'token-usage', 'session-1.jsonl');
    writeJsonLines(usage, [
      {
        ts: at(0),
        prompt_id: 'p-new',
        session_id: 's1',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        output_tokens: 0,
        actual_prompt_tokens: 1200,
        attempt_outcome: 'refusal',
        attempt_index: 0,
        refusal_category: null,
        refusal_explanation: null,
        request_id: 'req-1',
        dump_base_id: 'dump-1',
      },
      {
        ts: at(1_000),
        prompt_id: 'p-new',
        session_id: 's1',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        output_tokens: 0,
        actual_prompt_tokens: 1200,
        attempt_outcome: 'refusal',
        attempt_index: 1,
        refusal_category: null,
        request_id: 'req-2',
        dump_base_id: 'dump-2',
      },
      {
        ts: at(2_000),
        prompt_id: 'p-new',
        session_id: 's1',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        output_tokens: 20,
        actual_prompt_tokens: 1300,
        attempt_outcome: 'success',
        attempt_index: 2,
        dump_base_id: 'dump-accepted',
      },
      {
        ts: at(300_000),
        prompt_id: 'p-old',
        session_id: 's2',
        provider: 'anthropic',
        model: 'claude-opus-4',
        output_tokens: 0,
        actual_prompt_tokens: 900,
        attempt_outcome: 'success',
      },
      {
        ts: at(360_000),
        prompt_id: 'not-a-refusal',
        session_id: 's1',
        provider: 'openai',
        model: 'gpt-5',
        output_tokens: 0,
      },
      {
        ts: at(420_000),
        prompt_id: 'modern-empty-stop',
        session_id: 's1',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        output_tokens: 0,
        attempt_outcome: 'success',
        finish_reason: 'stop',
      },
    ]);
    fs.appendFileSync(usage, 'not-json\n');
    await recordJournalSession(project, {
      sessionId: 's1',
      cwd: 'alpha-workspace',
      rows: [
        { at: -30_000, speaker: 'human', blocks: text('accepted baseline') },
        {
          at: -20_000,
          speaker: 'human',
          blocks: summaryText,
          summaryAuthor,
        },
        {
          at: -10_000,
          speaker: 'human',
          blocks: text(
            'unusual quartz topic deadbeef deadbeef123456 123456 05z run_shell_command runShellCommand tool human ai run shell command',
          ),
        },
        {
          at: -5_000,
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call-read',
              toolName: 'read_file',
              result: { output: 'bounded tool output' },
            },
          ],
        },
        { at: 2_000, speaker: 'ai', blocks: text('accepted quartz answer') },
      ],
      refusals: [
        refusal('p-new', 0, 0, {
          refusal_category: null,
          partial_output: partialOutput('partial'),
          dump_base_id: 'dump-1',
        }),
        refusal('p-new', 1, 1_000, {
          refusal_category: null,
          partial_output: partialOutput('partial two'),
          dump_base_id: 'dump-2',
        }),
      ],
      rewrites: [
        {
          operationId: 'rewrite-1',
          time: at(1_000),
          promptId: 'p-new',
          attemptIndex: 1,
          reviewer: { provider: 'anthropic', model: 'claude-reviewer' },
          explanation: 'Reworded the refused request',
          changes: [
            {
              id: 'change-1',
              role: 'human',
              kind: 'user',
              originalText: 'unusual quartz topic',
              newText: 'quartz topic',
            },
          ],
        },
      ],
    });
    const cacheRoot = path.join(path.dirname(path.dirname(root)), 'dumps');
    fs.mkdirSync(cacheRoot, { recursive: true });
    for (const [id, outcome, text] of [
      ['dump-2', 'refusal', 'unusual quartz topic'],
      ['dump-accepted', 'success', 'accepted quartz answer'],
    ]) {
      fs.writeFileSync(
        path.join(cacheRoot, `${id}.json`),
        JSON.stringify({
          dump_base_id: id,
          prompt_id: 'p-new',
          attempt_outcome: outcome,
          request: { body: { messages: [{ role: 'user', content: text }] } },
        }),
      );
    }

    const output = runSurvey(root);
    const report = JSON.parse(output.stdout) as {
      runs: Array<Record<string, unknown>>;
      summary: {
        categories: Record<string, number>;
        compression: Record<string, { refusals: number; attempts: number }>;
      };
      diagnostics: { malformedLines: number };
    };
    expect(report.runs).toHaveLength(2);
    expect(report.runs[0]).toMatchObject({
      project: 'alpha-workspace',
      promptId: 'p-new',
      refusalAttempts: 2,
      recovery: 'rewrite',
      category: null,
      summaryAuthor: 'anthropic/claude-summary',
    });
    expect(report.summary.categories['unspecified']).toBe(3);
    expect(report.summary.compression['after-compression']).toMatchObject({
      refusals: 2,
      attempts: 3,
    });
    expect(report.summary.compression.elsewhere).toMatchObject({
      refusals: 0,
      attempts: 2,
    });
    expect(report.summary.compression['missing-evidence']).toMatchObject({
      refusals: 1,
      attempts: 1,
    });
    expect(report.diagnostics.malformedLines).toBe(1);
    expect(output.stderr).toContain('Category: unspecified');
    expect(output.stderr).toContain('recovery=rewrite');
    expect(output.stderr).toContain(
      'Before: tool:read_file: bounded tool output',
    );
    expect(output.stderr).toContain(
      'Terms more common in refused window: none',
    );
    expect(output.stderr).not.toContain('compression=undefined');

    const jsonPath = path.join(path.dirname(root), 'survey.json');
    const fileResult = Bun.spawnSync(
      [
        process.execPath,
        'scripts/refusal-survey.ts',
        '--root',
        root,
        '--json',
        jsonPath,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LLXPRT_LOG_HOME: path.dirname(path.dirname(root)),
          LLXPRT_CACHE_HOME: path.dirname(path.dirname(root)),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    expect(fileResult.exitCode).toBe(0);
    expect(fileResult.stdout.toString()).toContain('Category: unspecified');
    expect(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).runs).toHaveLength(2);
  });
});
