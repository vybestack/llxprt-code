/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from './turn.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ChatSession } from './chatSession.js';
import type { ServerAgentStreamEvent } from './turn.js';

// Restated from the specification — tests are the specification
const TURN_REPORT_HISTORY_TAIL = 8;
const MAX_REPORT_BYTES = 131_072;
const REPORT_FILE_PATTERN = /^llxprt-client-error-.*\.json$/;
const TEMP_ENV_KEYS = ['TMPDIR', 'TMP', 'TEMP'] as const;
type TempEnvKey = (typeof TEMP_ENV_KEYS)[number];

interface ReportContext {
  request: ContentBlock[];
  recentHistory: IContent[];
  omittedHistoryCount: number;
  baseUrl?: string;
}

interface ParsedReport {
  error: { message: string; stack?: string };
  context?: ReportContext;
  contextOmitted?: {
    reason: string;
    serializedBytes: number;
    limitBytes: number;
  };
}

/**
 * Minimal ChatSession fixture — the provider/network boundary. Only the
 * methods Turn.run actually calls before the error path are implemented;
 * sendMessageStream throws to drive handleRunError into the reportError path.
 */
interface FixtureChat {
  getHistory: (curated?: boolean) => IContent[];
  getConfig: () => undefined;
  getResolvedBaseUrl: () => string | undefined;
  sendMessageStream: () => Promise<never>;
}

function makeEntry(speaker: IContent['speaker'], text: string): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
  };
}

function createTurn(
  history: IContent[],
  errorMessage: string,
  baseUrl?: string,
): Turn {
  const chat: FixtureChat = {
    getHistory: () => history,
    getConfig: () => undefined,
    getResolvedBaseUrl: () => baseUrl,
    sendMessageStream: () => Promise.reject(new Error(errorMessage)),
  };
  return new Turn(
    chat as unknown as ChatSession,
    'prompt-test',
    DEFAULT_AGENT_ID,
    'fixture',
  );
}

async function collectEvents(
  turn: Turn,
  req: ContentBlock[],
): Promise<ServerAgentStreamEvent[]> {
  const events: ServerAgentStreamEvent[] = [];
  for await (const event of turn.run(req, new AbortController().signal)) {
    events.push(event);
  }
  return events;
}

describe('Turn error report payload (issue 3113)', () => {
  let tmpDir: string;
  let stderrSpy: ReturnType<typeof spyOn>;
  let savedTempEnv: Record<TempEnvKey, string | undefined>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-turn-report-'));
    savedTempEnv = {
      TMPDIR: process.env.TMPDIR,
      TMP: process.env.TMP,
      TEMP: process.env.TEMP,
    };
    const realTmpDir = await fs.realpath(tmpDir);
    for (const key of TEMP_ENV_KEYS) {
      process.env[key] = realTmpDir;
    }
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    stderrSpy.mockRestore();
    for (const key of TEMP_ENV_KEYS) {
      const savedValue = savedTempEnv[key];
      if (savedValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedValue;
      }
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function listReportFiles(): Promise<string[]> {
    const entries = await fs.readdir(tmpDir);
    return entries.filter((name) => REPORT_FILE_PATTERN.test(name)).sort();
  }

  async function readReport(name: string): Promise<ParsedReport> {
    const content = await fs.readFile(path.join(tmpDir, name), 'utf-8');
    return JSON.parse(content) as ParsedReport;
  }

  // T1: 25 entries -> recentHistory has 8, omittedHistoryCount === 17
  it('T1: bounds recentHistory to 8 entries with correct omittedHistoryCount', async () => {
    const history: IContent[] = [];
    for (let i = 0; i < 25; i++) {
      history.push(makeEntry(i % 2 === 0 ? 'human' : 'ai', `Turn ${i}`));
    }
    const turn = createTurn(history, 'T1 distinct error message');
    const req: ContentBlock[] = [{ text: 'T1 failing request' }];

    await collectEvents(turn, req);

    const files = await listReportFiles();
    expect(files.length).toBe(1);
    const report = await readReport(files[0]);
    if (report.context === undefined) {
      throw new Error('Expected report context');
    }
    expect(report.context.recentHistory.length).toBe(8);
    expect(report.context.omittedHistoryCount).toBe(17);
    expect(report.context.recentHistory).toEqual(
      history.slice(-TURN_REPORT_HISTORY_TAIL),
    );
  });

  // T2: request is semantically separate, not part of recentHistory
  it('T2: request is separate from recentHistory and deep-equals the request blocks', async () => {
    const history: IContent[] = [makeEntry('human', 'T2 prior')];
    const turn = createTurn(history, 'T2 distinct error message');
    const req: ContentBlock[] = [{ text: 'T2 failing request' }];

    await collectEvents(turn, req);

    const files = await listReportFiles();
    expect(files.length).toBe(1);
    const report = await readReport(files[0]);
    if (report.context === undefined) {
      throw new Error('Expected report context');
    }
    expect(report.context.request).toEqual(req);
    expect(report.context.recentHistory).not.toContainEqual(req);
  });

  // T3: Empty history -> recentHistory is [], omittedHistoryCount === 0
  it('T3: handles empty history with omittedHistoryCount 0 and empty recentHistory', async () => {
    const turn = createTurn([], 'T3 distinct error message');
    const req: ContentBlock[] = [{ text: 'T3 empty history request' }];

    await collectEvents(turn, req);

    const files = await listReportFiles();
    expect(files.length).toBe(1);
    const report = await readReport(files[0]);
    if (report.context === undefined) {
      throw new Error('Expected report context');
    }
    expect(report.context.recentHistory).toEqual([]);
    expect(report.context.omittedHistoryCount).toBe(0);
    expect(report.context.request).toEqual(req);
  });

  // T4: 3 entries (shorter than tail) -> all 3, omittedHistoryCount === 0
  it('T4: preserves all entries when history is shorter than the tail', async () => {
    const history: IContent[] = [
      makeEntry('human', 'T4 a'),
      makeEntry('ai', 'T4 b'),
      makeEntry('human', 'T4 c'),
    ];
    const turn = createTurn(history, 'T4 distinct error message');
    const req: ContentBlock[] = [{ text: 'T4 short history request' }];

    await collectEvents(turn, req);

    const files = await listReportFiles();
    expect(files.length).toBe(1);
    const report = await readReport(files[0]);
    if (report.context === undefined) {
      throw new Error('Expected report context');
    }
    expect(report.context.recentHistory).toEqual(history);
    expect(report.context.omittedHistoryCount).toBe(0);
  });

  // T5: 200 entries of 20,000 chars -> file <= 131,072 bytes, 8 recentHistory
  it('T5: bounds file size with large history entries', async () => {
    const history: IContent[] = [];
    for (let i = 0; i < 200; i++) {
      history.push(makeEntry('ai', 'X'.repeat(20_000)));
    }
    const turn = createTurn(history, 'T5 distinct error message');
    const req: ContentBlock[] = [{ text: 'T5 large history request' }];

    await collectEvents(turn, req);

    const files = await listReportFiles();
    expect(files.length).toBe(1);
    const stat = await fs.stat(path.join(tmpDir, files[0]));
    expect(stat.size).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    const report = await readReport(files[0]);
    if (report.context === undefined) {
      throw new Error('Expected report context');
    }
    expect(report.context.recentHistory.length).toBe(8);
  });

  // T6: Report text contains no newlines (compact JSON)
  it('T6: writes compact JSON with no newlines', async () => {
    const turn = createTurn(
      [makeEntry('human', 'T6 prior')],
      'T6 distinct error message',
    );
    const req: ContentBlock[] = [{ text: 'T6 compact request' }];

    await collectEvents(turn, req);

    const files = await listReportFiles();
    expect(files.length).toBe(1);
    const raw = await fs.readFile(path.join(tmpDir, files[0]), 'utf-8');
    expect(raw.includes('\n')).toBe(false);
  });

  // T7: Exactly one Error event is yielded with the unchanged structured error
  it('T7: yields exactly one Error event with the structured error', async () => {
    const turn = createTurn(
      [makeEntry('human', 'T7 prior')],
      'T7 distinct error message',
    );
    const req: ContentBlock[] = [{ text: 'T7 event check' }];

    const events = await collectEvents(turn, req);
    expect(events).toEqual([
      {
        type: AgentEventType.Error,
        value: { error: { message: 'T7 distinct error message' } },
      },
    ]);
  });

  // T8: Exactly one report file with the expected type prefix
  it('T8: writes exactly one report file with Turn.run-sendMessageStream type', async () => {
    const turn = createTurn(
      [makeEntry('human', 'T8 prior')],
      'T8 distinct error message',
    );
    const req: ContentBlock[] = [{ text: 'T8 one file check' }];

    await collectEvents(turn, req);

    const files = await listReportFiles();
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(
      /^llxprt-client-error-Turn\.run-sendMessageStream-/,
    );
  });

  /**
   * @plan:PLAN-20260824-ISSUE2231.P01
   * @requirement:REQ-2231-1
   */
  it('E1: includes the resolved endpoint in the stderr base message', async () => {
    const turn = createTurn(
      [],
      'E1 endpoint message error',
      'https://ollama.example/v1/',
    );
    const req: ContentBlock[] = [{ text: 'E1 failing request' }];

    await collectEvents(turn, req);

    const stderr = stderrSpy.mock.calls
      .map(([chunk]) => String(chunk))
      .join('');
    expect(stderr).toContain(
      'Error when talking to fixture (endpoint: https://ollama.example/v1/)',
    );
  });

  /**
   * @plan:PLAN-20260824-ISSUE2231.P01
   * @requirement:REQ-2231-3
   */
  it('E2: records the resolved endpoint in the report context', async () => {
    const turn = createTurn(
      [],
      'E2 endpoint context error',
      'https://ollama.example/v1/',
    );
    const req: ContentBlock[] = [{ text: 'E2 failing request' }];

    await collectEvents(turn, req);

    const files = await listReportFiles();
    expect(files.length).toBe(1);
    const report = await readReport(files[0]);
    if (report.context === undefined) {
      throw new Error('Expected report context');
    }
    expect(report.context.baseUrl).toEqual('https://ollama.example/v1/');
  });

  /**
   * @plan:PLAN-20260824-ISSUE2231.P01
   * @requirement:REQ-2231-2
   * @requirement:REQ-2231-3
   */
  it('E3: preserves the API fallback and omits baseUrl when unresolved', async () => {
    const turn = createTurn([], 'E3 unresolved endpoint error');
    const req: ContentBlock[] = [{ text: 'E3 failing request' }];

    await collectEvents(turn, req);

    const stderr = stderrSpy.mock.calls
      .map(([chunk]) => String(chunk))
      .join('');
    expect(stderr).toContain('Error when talking to fixture API');
    expect(stderr).not.toContain('(endpoint:');
    const files = await listReportFiles();
    expect(files.length).toBe(1);
    const report = await readReport(files[0]);
    if (report.context === undefined) {
      throw new Error('Expected report context');
    }
    expect('baseUrl' in report.context).toBe(false);
  });

  /**
   * @plan:PLAN-20260824-ISSUE2231.P01
   * @requirement:REQ-2231-5
   */
  it('E4: leaves the structured error event unchanged when an endpoint resolves', async () => {
    const turn = createTurn(
      [],
      'E4 unchanged event error',
      'https://ollama.example/v1/',
    );
    const req: ContentBlock[] = [{ text: 'E4 failing request' }];

    const events = await collectEvents(turn, req);

    expect(events).toEqual([
      {
        type: AgentEventType.Error,
        value: { error: { message: 'E4 unchanged event error' } },
      },
    ]);
  });
});
