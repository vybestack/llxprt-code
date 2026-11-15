/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

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
  it('joins legacy token usage by prompt prefix when session ids differ', () => {
    const root = path.join(fixtureRoot(), 'logs', 'tmp');
    const project = path.join(root, 'legacy-prefix');
    writeJsonLines(path.join(project, 'token-usage', 'usage-id.jsonl'), [
      {
        ts: '2026-11-02T10:00:00Z',
        prompt_id: 'legacy-session-uuid-prompt-1',
        session_id: 'usage-file-id',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        attempt_outcome: 'refusal',
        attempt_index: 0,
      },
    ]);
    writeJsonLines(path.join(project, 'chats', 'journal.jsonl'), [
      {
        seq: 1,
        ts: '2026-11-02T09:00:00Z',
        type: 'session_start',
        payload: {
          sessionId: 'legacy-session-uuid',
          workspaceDirs: ['/legacy'],
        },
      },
      {
        seq: 2,
        ts: '2026-11-02T09:59:59.700Z',
        type: 'compressed',
        payload: {},
      },
    ]);
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

  it('uses a unique timestamp-covering journal when prompt prefixes are ambiguous', () => {
    const root = path.join(fixtureRoot(), 'logs', 'tmp');
    const project = path.join(root, 'legacy-time');
    writeJsonLines(path.join(project, 'token-usage', 'usage.jsonl'), [
      {
        ts: '2026-11-02T10:00:00Z',
        prompt_id: 'legacy-session-prompt',
        session_id: 'different-usage-id',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        attempt_outcome: 'refusal',
        attempt_index: 0,
      },
    ]);
    writeJsonLines(path.join(project, 'chats', 'first.jsonl'), [
      {
        seq: 1,
        ts: '2026-11-02T08:00:00Z',
        type: 'session_start',
        payload: { sessionId: 'legacy' },
      },
      { seq: 2, ts: '2026-11-02T08:30:00Z', type: 'compressed', payload: {} },
    ]);
    writeJsonLines(path.join(project, 'chats', 'second.jsonl'), [
      {
        seq: 1,
        ts: '2026-11-02T09:59:00Z',
        type: 'session_start',
        payload: { sessionId: 'legacy-session' },
      },
      { seq: 2, ts: '2026-11-02T10:00:00Z', type: 'compressed', payload: {} },
    ]);
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

  it('does not join a child session to its parent compression history', () => {
    const root = path.join(fixtureRoot(), 'logs', 'tmp');
    const project = path.join(root, 'project-isolation');
    writeJsonLines(path.join(project, 'token-usage', 'child.jsonl'), [
      {
        ts: '2026-11-02T10:00:00Z',
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
    writeJsonLines(path.join(project, 'chats', 'parent.jsonl'), [
      {
        v: 1,
        seq: 1,
        ts: '2026-11-02T09:59:00Z',
        type: 'session_start',
        payload: { sessionId: 'parent', workspaceDirs: ['/project'] },
      },
      {
        v: 1,
        seq: 2,
        ts: '2026-11-02T09:59:40Z',
        type: 'compressed',
        payload: { summary_author_model: 'parent-summary' },
      },
    ]);
    writeJsonLines(path.join(project, 'chats', 'child.jsonl'), [
      {
        v: 1,
        seq: 1,
        ts: '2026-11-02T09:59:00Z',
        type: 'session_start',
        payload: { sessionId: 'parent::child', workspaceDirs: ['/project'] },
      },
    ]);

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

  it('groups refusal attempts and correlates compression, recovery, dumps and categories', () => {
    const root = path.join(fixtureRoot(), 'logs', 'tmp');
    const project = path.join(root, 'project-alpha');
    const usage = path.join(project, 'token-usage', 'session-1.jsonl');
    writeJsonLines(usage, [
      {
        ts: '2026-11-02T10:00:00Z',
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
        ts: '2026-11-02T10:00:01Z',
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
        ts: '2026-11-02T10:00:02Z',
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
        ts: '2026-11-02T10:05:00Z',
        prompt_id: 'p-old',
        session_id: 's2',
        provider: 'anthropic',
        model: 'claude-opus-4',
        output_tokens: 0,
        actual_prompt_tokens: 900,
        attempt_outcome: 'success',
      },
      {
        ts: '2026-11-02T10:06:00Z',
        prompt_id: 'not-a-refusal',
        session_id: 's1',
        provider: 'openai',
        model: 'gpt-5',
        output_tokens: 0,
      },
      {
        ts: '2026-11-02T10:07:00Z',
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
    writeJsonLines(path.join(project, 'chats', 'session-1.jsonl'), [
      {
        v: 1,
        seq: 1,
        ts: '2026-11-02T09:59:00Z',
        type: 'session_start',
        payload: { sessionId: 's1', workspace: 'alpha-workspace' },
      },
      {
        v: 1,
        seq: 2,
        ts: '2026-11-02T09:59:30Z',
        type: 'content',
        payload: {
          content: {
            speaker: 'user',
            blocks: [{ type: 'text', text: 'accepted baseline' }],
          },
        },
      },
      {
        v: 1,
        seq: 3,
        ts: '2026-11-02T09:59:40Z',
        type: 'compressed',
        payload: {
          summaryAuthor: { provider: 'anthropic', model: 'claude-summary' },
        },
      },
      {
        v: 1,
        seq: 4,
        ts: '2026-11-02T09:59:50Z',
        type: 'content',
        payload: {
          content: {
            speaker: 'user',
            blocks: [
              {
                type: 'text',
                text: 'unusual quartz topic deadbeef deadbeef123456 123456 05z run_shell_command runShellCommand tool human ai run shell command',
              },
            ],
          },
        },
      },
      {
        v: 1,
        seq: 4.5,
        ts: '2026-11-02T09:59:55Z',
        type: 'content',
        payload: {
          content: {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                toolName: 'read_file',
                result: { output: 'bounded tool output' },
              },
            ],
          },
        },
      },
      {
        v: 1,
        seq: 5,
        ts: '2026-11-02T10:00:00Z',
        type: 'refusal',
        payload: {
          prompt_id: 'p-new',
          attempt_index: 0,
          refusal_category: null,
          partial_output: { text: 'partial' },
          dump_base_id: 'dump-1',
        },
      },
      {
        v: 1,
        seq: 6,
        ts: '2026-11-02T10:00:01Z',
        type: 'refusal',
        payload: {
          prompt_id: 'p-new',
          attempt_index: 1,
          refusal_category: null,
          partial_output: { text: 'partial two' },
          dump_base_id: 'dump-2',
        },
      },
      {
        v: 1,
        seq: 7,
        ts: '2026-11-02T10:00:01Z',
        type: 'refusal_rewrite',
        payload: { prompt_id: 'p-new', attempt_index: 1 },
      },
      {
        v: 1,
        seq: 8,
        ts: '2026-11-02T10:00:02Z',
        type: 'content',
        payload: {
          content: {
            speaker: 'assistant',
            blocks: [{ type: 'text', text: 'accepted quartz answer' }],
          },
        },
      },
    ]);
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
      'Terms more common in refused window: baseline, bounded, output, topic, unusual',
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
