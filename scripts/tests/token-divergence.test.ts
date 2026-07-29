/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  projectPromptBearingFields,
  resolveProtocol,
  countChars,
  countTiktoken,
  ordinaryLeastSquares,
  meanAbsolutePercentageError,
  rootMeanSquareError,
  evaluateGate,
  pairArtifacts,
  parseCliOutput,
  extractUserContent,
  PROJECTION_VERSION,
  type ProjectionProtocol,
} from '../token-divergence.js';
import {
  TRAIN_COUNT,
  getCorpus,
  getCorpusItem,
  CORPUS_VERSION,
} from '../token-divergence-corpus.js';
import { generateReport } from '../token-divergence-report.js';
import {
  collect,
  TARGETS,
  validateSanitizedRow,
  type ProcessRunner,
  type RunResult,
} from '../token-divergence-collect.js';
import { createHash } from 'node:crypto';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'td-'));
const wj = (p: string, d: unknown): void =>
  fs.writeFileSync(p, JSON.stringify(d), 'utf-8');
const wjl = (p: string, rows: unknown[]): void =>
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n'), 'utf-8');
const ph = (prompt: string): string =>
  createHash('sha256').update(prompt).digest('hex').slice(0, 16);

function usageRow(
  o: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    ts: '2026-01-01T00:00:00Z',
    prompt_id: 'prompt-1',
    provider: 'openai',
    model: 'gpt-4',
    estimated_tokens: 8,
    estimator: 'openai-tiktoken',
    tiktoken_tokens: 7,
    tiktoken_estimation_failed: false,
    actual_prompt_tokens: 18166,
    cached_tokens: 0,
    effective_actual_tokens: 18166,
    ...o,
  };
}

function cliOutput(
  o: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    session_id: 'sess-1',
    response: 'OK',
    stats: {
      models: {
        'gpt-4': {
          api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 100 },
          tokens: { input: 18166, prompt: 18166, output: 2, total: 18168 },
        },
      },
    },
    ...o,
  };
}

function modelStats(
  model: string,
  prompt: number,
  req = 1,
  err = 0,
): Record<string, unknown> {
  return {
    stats: {
      models: {
        [model]: {
          api: { totalRequests: req, totalErrors: err, totalLatencyMs: 0 },
          tokens: { prompt },
        },
      },
    },
  };
}

const EXP: {
  model: string;
  prompt: string;
  protocol: ProjectionProtocol;
  endpointHost: string;
} = {
  model: 'gpt-4',
  prompt: 'Hello',
  protocol: 'openai-chat',
  endpointHost: 'api.openai.com',
};

function synthRow(target: string, id: number): Record<string, unknown> {
  const spec = TARGETS.find((c) => c.key === target);
  if (spec === undefined) throw new Error(`Unknown target ${target}`);
  const item = getCorpusItem(id);
  const size = Math.floor((id - 1) / 5) + 1;
  return {
    target,
    profile: spec.profile,
    protocol: spec.protocol,
    endpointHost: spec.endpointHost,
    model: spec.model,
    corpusId: id,
    split: item.split,
    category: item.category,
    sessionId: `${target}-${id}`,
    pendingTokens: size * 100,
    requestChars: 50_000 + size * 400,
    charPrediction: 12_500 + size * 100,
    genuineTiktoken: 13_000 + size * 100,
    actualPromptTokens: 10_000 + size * 200,
    cachedTokens: 0,
    rejectedAttempts: 0,
    commitSha: 'x',
    projectionVersion: PROJECTION_VERSION,
    corpusVersion: CORPUS_VERSION,
    requestHash: `${target}-${id}`,
    promptHash: ph(item.prompt),
    systemHash: 'system',
    toolsHash: 'tools',
  };
}

const TARGET_KEYS = [
  'opusthinking',
  'gpt56solhigh',
  'zai',
  'ollamaglm51',
  'ollamakimi',
];

function completeResults(): string {
  const rows: Array<Record<string, unknown>> = [];
  for (const t of TARGET_KEYS)
    for (let id = 1; id <= 25; id++) rows.push(synthRow(t, id));
  return rows.map((r) => JSON.stringify(r)).join('\n');
}

// ─── Protocol projection (finding #4) ──────────────────────────────────────

describe('resolveProtocol + projectPromptBearingFields', () => {
  const cases: ReadonlyArray<{
    name: string;
    provider: string;
    endpoint: string;
    body: Record<string, unknown>;
    expected: ProjectionProtocol;
    keys: readonly string[];
  }> = [
    {
      name: 'openai-chat',
      provider: 'openai',
      endpoint: '/chat/completions',
      body: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
      },
      expected: 'openai-chat',
      keys: ['messages', 'tools'],
    },
    {
      name: 'anthropic',
      provider: 'anthropic',
      endpoint: '/messages',
      body: { model: 'claude-3', system: 'sys', messages: [], tools: [] },
      expected: 'anthropic-messages',
      keys: ['system', 'messages', 'tools'],
    },
    {
      name: 'responses',
      provider: 'openai-responses',
      endpoint: '/responses',
      body: { model: 'gpt-5', instructions: 'x', input: [], tools: [] },
      expected: 'openai-responses',
      keys: ['instructions', 'input', 'tools'],
    },
    {
      name: 'codex alias resolves responses',
      provider: 'codex',
      endpoint: '/responses',
      body: {
        model: 'gpt-5.6-sol',
        instructions: 'sys',
        input: [{ type: 'message', role: 'user', content: 'OK' }],
      },
      expected: 'openai-responses',
      keys: ['instructions', 'input'],
    },
  ];
  for (const c of cases) {
    it(`A5: ${c.name}`, () => {
      const proto = resolveProtocol({
        providerName: c.provider,
        endpointPath: c.endpoint,
        body: c.body,
      });
      expect(proto).toBe(c.expected);
      const proj = projectPromptBearingFields(proto, c.body);
      for (const k of c.keys) expect(proj).toHaveProperty(k);
    });
  }
  it('A5: rejects ambiguous shape', () => {
    expect(() =>
      resolveProtocol({
        providerName: 'x',
        endpointPath: '/x',
        body: { foo: 'bar' },
      }),
    ).toThrow();
  });
  it('A5: rejects absent body', () => {
    expect(() =>
      projectPromptBearingFields('openai-chat', undefined),
    ).toThrow();
  });
});

describe('countChars / countTiktoken', () => {
  it('A5: counts UTF-16 units and genuine tiktoken', () => {
    expect(countChars('hello')).toBe(5);
    expect(countChars('😀')).toBe(2);
    expect(countTiktoken('hello world')).toBeGreaterThan(0);
    expect(countTiktoken('hello world')).toBeLessThan(10);
    expect(countTiktoken('a '.repeat(100))).toBeGreaterThan(countTiktoken('a'));
  });
});

// ─── Statistics ─────────────────────────────────────────────────────────────

describe('statistics', () => {
  it('A7: OLS fits y=2x+1', () => {
    const f = ordinaryLeastSquares([
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 },
    ]);
    expect(f.slope).toBeCloseTo(2, 5);
    expect(f.intercept).toBeCloseTo(1, 5);
  });
  it('A7: OLS rejects <2 points / non-positive y', () => {
    expect(() => ordinaryLeastSquares([{ x: 1, y: 2 }])).toThrow();
    expect(() =>
      ordinaryLeastSquares([
        { x: 1, y: 0 },
        { x: 2, y: 5 },
      ]),
    ).toThrow();
  });
  it('A7: MAPE 7.5 for [100,200]/[110,190], rejects non-positive', () => {
    expect(meanAbsolutePercentageError([100, 200], [110, 190])).toBeCloseTo(
      7.5,
      5,
    );
    expect(() => meanAbsolutePercentageError([0], [10])).toThrow();
  });
  it('A7: RMSE 1 for [3,5]/[4,4]', () => {
    expect(rootMeanSquareError([3, 5], [4, 4])).toBeCloseTo(1, 5);
  });
  it('A8: gate pass/fail logic', () => {
    const gate = (cm: number, cr: number, fm: number, fr: number) =>
      evaluateGate({
        currentMape: cm,
        currentRmse: cr,
        fittedMape: fm,
        fittedRmse: fr,
      }).passed;
    expect(gate(50, 1000, 10, 200)).toBe(true);
    expect(gate(10, 200, 15, 100)).toBe(false);
    expect(gate(NaN, 1, 1, 1)).toBe(false);
  });
  it('#4: RMSE-only gate failure when MAPE passes but RMSE is worse', () => {
    const r = evaluateGate({
      currentMape: 50,
      currentRmse: 100,
      fittedMape: 40,
      fittedRmse: 200,
    });
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('RMSE');
  });
});

// ─── CLI output schema (finding #2) ─────────────────────────────────────────

describe('parseCliOutput', () => {
  it('parses real stats.models[model].tokens.prompt', () => {
    const r = parseCliOutput(cliOutput());
    expect(r.sessionId).toBe('sess-1');
    expect(r.actualPromptTokens).toBe(18166);
    expect(r.model).toBe('gpt-4');
  });
  it('requires exactly one model, totalRequests=1, totalErrors=0, positive prompt', () => {
    expect(() =>
      parseCliOutput(cliOutput({ stats: { models: { a: {}, b: {} } } })),
    ).toThrow();
    expect(() =>
      parseCliOutput(cliOutput(modelStats('gpt-4', 100, 2))),
    ).toThrow();
    expect(() =>
      parseCliOutput(cliOutput(modelStats('gpt-4', 100, 1, 1))),
    ).toThrow();
    expect(() => parseCliOutput(cliOutput(modelStats('gpt-4', 0)))).toThrow();
  });
  it('accepts input tokens when prompt tokens absent', () => {
    const o = cliOutput({
      stats: {
        models: {
          'gpt-4': {
            api: { totalRequests: 1, totalErrors: 0 },
            tokens: { input: 18166 },
          },
        },
      },
    });
    expect(parseCliOutput(o).actualPromptTokens).toBe(18166);
  });
  it('#1: rejects response that is not exactly "OK"', () => {
    expect(() => parseCliOutput(cliOutput({ response: 'OK.' }))).toThrow();
    expect(() => parseCliOutput(cliOutput({ response: '' }))).toThrow();
  });
});

// ─── Artifact pairing (A4, #1 strict binding, #5 validators) ────────────────

describe('pairArtifacts', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmp();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function chatDump(
    model = 'gpt-4',
    userContent = 'Hello',
    extraMsgs: Array<Record<string, unknown>> = [],
  ): Record<string, unknown> {
    return {
      provider: 'openai',
      timestamp: '',
      request: {
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        body: {
          model,
          messages: [...extraMsgs, { role: 'user', content: userContent }],
          tools: [],
        },
      },
    };
  }

  function setup(o: {
    dump?: Record<string, unknown>;
    row?: Record<string, unknown>;
    out?: Record<string, unknown>;
    usageName?: string;
  }): { d: string; u: string; p: string } {
    const sid = o.out?.['session_id'] ?? 'sess-1';
    const d = path.join(dir, 'req-request.json');
    const u = path.join(dir, o.usageName ?? `${sid}.jsonl`);
    const p = path.join(dir, 'output.json');
    wj(d, o.dump ?? chatDump());
    wjl(u, [usageRow(o.row)]);
    wj(p, o.out ?? cliOutput());
    return { d, u, p };
  }

  function pair(d: string, u: string, p: string, exp = EXP) {
    return pairArtifacts({
      dumpPath: d,
      usagePath: u,
      outputPath: p,
      expected: exp,
    });
  }

  it('A4: accepts valid paired set with session correlation', () => {
    const { d, u, p } = setup({});
    const r = pair(d, u, p);
    expect(r.actualPromptTokens).toBe(18166);
    expect(r.sessionId).toBe('sess-1');
    expect(r.protocol).toBe('openai-chat');
    expect(r.requestChars).toBeGreaterThan(0);
    expect(r.response).toBe('OK');
    expect(r.userContentHash).not.toBe('');
  });

  it('A10: hashes OpenAI Chat system messages separately', () => {
    const mk = (content: string) => {
      const a = setup({
        dump: chatDump('gpt-4', 'Hello', [{ role: 'system', content }]),
      });
      return pair(a.d, a.u, a.p);
    };
    expect(mk('first policy').systemHash).not.toBe(
      mk('second policy').systemHash,
    );
  });

  it('A4: rejects usage basename not matching session_id', () => {
    const { d, p } = setup({ usageName: 'wrong.jsonl' });
    expect(() => pair(d, path.join(dir, 'wrong.jsonl'), p)).toThrow();
  });

  it('A4: rejects mismatched model / actual / multiple rows', () => {
    const a = setup({
      row: usageRow({ model: 'gpt-4' }),
      out: cliOutput(modelStats('diff', 18166)),
    });
    expect(() => pair(a.d, a.u, a.p)).toThrow();
    const b = setup({ out: cliOutput(modelStats('gpt-4', 999)) });
    expect(() => pair(b.d, b.u, b.p)).toThrow();
    const u2 = path.join(dir, 'sess-1.jsonl');
    wjl(u2, [
      usageRow(),
      usageRow({ prompt_id: 'p2', actual_prompt_tokens: 200 }),
    ]);
    expect(() => pair(b.d, u2, b.p)).toThrow();
  });

  it('A4: rejects nonpositive actual; #5: rejects invalid types', () => {
    const { d, u, p } = setup({
      row: usageRow({ actual_prompt_tokens: 0 }),
      out: cliOutput(modelStats('gpt-4', 0)),
    });
    expect(() => pair(d, u, p)).toThrow();
    const bd = path.join(dir, 'bad.json');
    wj(bd, { timestamp: '', request: { url: 'x', method: 'POST' } });
    expect(() => pair(bd, u, p)).toThrow();
    const x = setup({
      row: usageRow({ actual_prompt_tokens: 'x' as unknown as number }),
    });
    expect(() => pair(x.d, x.u, x.p)).toThrow();
  });

  it('A5: pairs codex dump via responses projection', () => {
    const { d, u, p } = setup({
      dump: {
        provider: 'codex',
        timestamp: '',
        request: {
          url: 'https://chatgpt.com/backend-api/codex/responses',
          method: 'POST',
          body: {
            model: 'gpt-5.6-sol',
            instructions: 'x',
            input: [{ type: 'message', role: 'user', content: 'OK' }],
            tools: [],
          },
        },
      },
      row: usageRow({ provider: 'codex', model: 'gpt-5.6-sol' }),
      out: cliOutput(modelStats('gpt-5.6-sol', 18166)),
    });
    const r = pair(d, u, p, {
      model: 'gpt-5.6-sol',
      prompt: 'OK',
      protocol: 'openai-responses',
      endpointHost: 'chatgpt.com',
    });
    expect(r.protocol).toBe('openai-responses');
    expect(r.endpointHost).toBe('chatgpt.com');
  });

  it('#1: rejects strict pairing mismatches (response, body model, user content, protocol)', () => {
    const r1 = setup({ out: cliOutput({ response: 'Not OK' }) });
    expect(() => pair(r1.d, r1.u, r1.p)).toThrow('OK');
    const r2 = setup({});
    const wd = path.join(dir, 'wrong-model.json');
    wj(wd, chatDump('different'));
    expect(() => pair(wd, r2.u, r2.p)).toThrow('Model mismatch');
    const r3 = setup({ dump: chatDump('gpt-4', 'WRONG') });
    expect(() => pair(r3.d, r3.u, r3.p)).toThrow('user content');
    const r4 = setup({});
    expect(() =>
      pair(r4.d, r4.u, r4.p, { ...EXP, protocol: 'anthropic-messages' }),
    ).toThrow('Protocol');
  });
});

// ─── extractUserContent (finding #1) ────────────────────────────────────────

describe('extractUserContent', () => {
  it('extracts user content from all protocols', () => {
    expect(
      extractUserContent('openai-chat', {
        messages: [{ role: 'user', content: 'hello' }],
      }),
    ).toBe('hello');
    expect(
      extractUserContent('openai-chat', {
        messages: [
          { role: 'system', content: 'sys' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'a ' },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      }),
    ).toBe('a b');
    expect(
      extractUserContent('openai-responses', {
        instructions: 'sys',
        input: [{ type: 'message', role: 'user', content: 'OK' }],
      }),
    ).toBe('OK');
    expect(extractUserContent('openai-chat', { messages: [] })).toBe('');
  });
});

// ─── Corpus completeness (finding #7) ───────────────────────────────────────

describe('corpus', () => {
  it('has 25 items: 20 train + 5 heldout, all 5 categories, OK directive, length variance', () => {
    const c = getCorpus();
    expect(c).toHaveLength(25);
    expect(c.filter((i) => i.split === 'train')).toHaveLength(TRAIN_COUNT);
    expect(c.filter((i) => i.split === 'heldout')).toHaveLength(5);
    expect(new Set(c.map((i) => i.category)).size).toBe(5);
    for (const i of c) expect(i.prompt).toContain('OK');
    const lens = c.map((i) => i.prompt.length);
    expect(Math.max(...lens) - Math.min(...lens)).toBeGreaterThan(500);
  });
  it('IDs 1-20 train, 21-25 heldout; stable version', () => {
    for (const i of getCorpus())
      expect(i.split).toBe(i.id <= 20 ? 'train' : 'heldout');
    expect(CORPUS_VERSION).toBe('2026-07-28-v1');
  });
});

// ─── Report generation (A7, A9, A11, #2 provenance, #4 held-out isolation) ─

describe('generateReport', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmp();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('A11: generates complete report with no TBDs; A7: slope identifiable', () => {
    const rp = path.join(dir, 'r.jsonl');
    const op = path.join(dir, 'rep.md');
    const ap = path.join(dir, 'an.json');
    fs.writeFileSync(rp, completeResults(), 'utf-8');
    generateReport({ resultsPath: rp, outputPath: op, analysisPath: ap });
    const rep = fs.readFileSync(op, 'utf-8');
    expect(rep).toContain('Runtime Token Estimator Divergence');
    for (const t of TARGET_KEYS) expect(rep).toContain(t);
    for (const s of [
      'MAPE',
      'within-category incremental',
      'controls for',
      'Samples: 5 controls, 15 train deltas, 5 held-out deltas',
      'Runtime estimator',
      'Delta from current',
      'Cached-token summary',
      'Rejected attempts',
      'Provenance',
      'Held-out errors',
      'Validity caveats',
    ])
      expect(rep).toContain(s);
    expect(rep).not.toContain('TBD');
    const an = JSON.parse(fs.readFileSync(ap, 'utf-8'));
    expect(an.targets).toHaveLength(5);
    expect(an.analysisMethod).toBe('within-category incremental');
    expect(an.targets[0].slope).toBeCloseTo(2);
    expect(an.targets[0].intercept).toBeCloseTo(0);
    expect(an.targets[0].currentMape).toBeCloseTo(50);
    expect(an.targets[0].fittedMape).toBeCloseTo(0);
  });

  it('A9: rejects incomplete (missing target / wrong train count)', () => {
    const rp = path.join(dir, 'r.jsonl');
    const op = path.join(dir, 'rep.md');
    const missTarget = completeResults()
      .split('\n')
      .filter((l) => !l.includes('ollamakimi'))
      .join('\n');
    fs.writeFileSync(rp, missTarget, 'utf-8');
    expect(() => generateReport({ resultsPath: rp, outputPath: op })).toThrow();
    const missRow = completeResults()
      .split('\n')
      .filter((l) => !l.includes('"corpusId":1,'))
      .join('\n');
    fs.writeFileSync(rp, missRow, 'utf-8');
    expect(() => generateReport({ resultsPath: rp, outputPath: op })).toThrow();
  });

  it('#4: changing only held-out values leaves slope/intercept unchanged while metrics change', () => {
    const rp1 = path.join(dir, 'r1.jsonl');
    const rp2 = path.join(dir, 'r2.jsonl');
    const op = path.join(dir, 'rep.md');
    const ap1 = path.join(dir, 'an1.json');
    const ap2 = path.join(dir, 'an2.json');
    fs.writeFileSync(rp1, completeResults(), 'utf-8');
    fs.writeFileSync(
      rp2,
      completeResults()
        .split('\n')
        .map((line) => {
          const row = JSON.parse(line) as Record<string, unknown>;
          if (row['split'] === 'heldout')
            return JSON.stringify({
              ...row,
              actualPromptTokens: (row['actualPromptTokens'] as number) + 500,
              sessionId: `${row['sessionId']!}-mod`,
            });
          return line;
        })
        .join('\n'),
      'utf-8',
    );
    generateReport({ resultsPath: rp1, outputPath: op, analysisPath: ap1 });
    generateReport({ resultsPath: rp2, outputPath: op, analysisPath: ap2 });
    const an1 = JSON.parse(fs.readFileSync(ap1, 'utf-8'));
    const an2 = JSON.parse(fs.readFileSync(ap2, 'utf-8'));
    for (let i = 0; i < an1.targets.length; i++) {
      expect(an2.targets[i].slope).toBeCloseTo(an1.targets[i].slope, 10);
      expect(an2.targets[i].intercept).toBeCloseTo(
        an1.targets[i].intercept,
        10,
      );
    }
    const mapeDiffers = an1.targets.some(
      (t: { currentMape: number }, i: number) =>
        Math.abs(t.currentMape - an2.targets[i].currentMape) > 0.01,
    );
    expect(mapeDiffers).toBe(true);
  });

  it('#2: rejects corrupted provenance (wrong corpusVersion, promptHash, category, mixed commitSha)', () => {
    const rp = path.join(dir, 'r.jsonl');
    const op = path.join(dir, 'rep.md');
    const firstRow = JSON.parse(completeResults().split('\n')[0]!) as Record<
      string,
      unknown
    >;
    expect(() =>
      validateSanitizedRow({ ...firstRow, promptHash: 'deadbeefdeadbeef' }),
    ).toThrow('promptHash');
    expect(() =>
      validateSanitizedRow({ ...firstRow, category: 'unicode' }),
    ).toThrow('category');
    const cvCorrupted = completeResults()
      .split('\n')
      .map((line, idx) =>
        idx === 0
          ? JSON.stringify({ ...JSON.parse(line), corpusVersion: 'tampered' })
          : line,
      )
      .join('\n');
    fs.writeFileSync(rp, cvCorrupted, 'utf-8');
    expect(() => generateReport({ resultsPath: rp, outputPath: op })).toThrow(
      'corpusVersion',
    );
    const lines = completeResults().split('\n');
    const last = JSON.parse(lines[lines.length - 1]!);
    lines[lines.length - 1] = JSON.stringify({
      ...last,
      commitSha: 'different',
    });
    fs.writeFileSync(rp, lines.join('\n'), 'utf-8');
    expect(() => generateReport({ resultsPath: rp, outputPath: op })).toThrow(
      'commitSha',
    );
  });
});

// ─── Collect runner (finding #6 targets, #9 safe resume) ────────────────────

describe('collect', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmp();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const noopRunner: ProcessRunner = {
    async run(): Promise<RunResult> {
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };

  it('targets matrix has exactly 5 targets; 5th uses minimax-m3 override', () => {
    expect(TARGETS).toHaveLength(5);
    expect(TARGETS.map((t) => t.key)).toEqual([
      'opusthinking',
      'gpt56solhigh',
      'zai',
      'ollamaglm51',
      'ollamakimi',
    ]);
    expect(TARGETS[0]!.profile).toBe('opusthinking-claudecode');
    expect(TARGETS[4]!.model).toBe('minimax-m3');
  });

  it('rejects unknown target filter', async () => {
    await expect(
      collect({
        resultsPath: path.join(dir, 'r.jsonl'),
        artifactsDir: dir,
        target: 'nope',
        runner: noopRunner,
      }),
    ).rejects.toThrow();
  });

  it('uses an attempt-specific seed when retrying MiniMax', async () => {
    const itemDir = path.join(dir, 'ollamakimi', '10');
    fs.mkdirSync(path.join(itemDir, 'attempt-first'), { recursive: true });
    fs.mkdirSync(path.join(itemDir, 'attempt-second'), { recursive: true });
    const fake: ProcessRunner = {
      async run(args): Promise<RunResult> {
        if (!args.includes('seed=2010')) throw new Error('missing retry seed');
        throw new Error('seed observed');
      },
    };
    await expect(
      collect({
        resultsPath: path.join(dir, 'r.jsonl'),
        artifactsDir: dir,
        target: 'ollamakimi',
        corpusId: 10,
        runner: fake,
      }),
    ).rejects.toThrow('seed observed');
  });

  it('safe resume: skips already-accepted target+id rows', async () => {
    const rp = path.join(dir, 'r.jsonl');
    const existing = synthRow('opusthinking', 1);
    fs.writeFileSync(rp, `${JSON.stringify(existing)}\n`, 'utf-8');
    await collect({
      resultsPath: rp,
      artifactsDir: dir,
      target: 'opusthinking',
      corpusId: 1,
      runner: noopRunner,
    });
    expect(fs.readFileSync(rp, 'utf-8').trim().split('\n')).toHaveLength(1);
  });

  it('collects from isolated cache while preserving global profile auth', async () => {
    const rp = path.join(dir, 'r.jsonl');
    const origConfigHome = process.env['LLXPRT_CONFIG_HOME'];
    const corpusItem = getCorpusItem(1);
    const fake: ProcessRunner = {
      async run(args, env): Promise<RunResult> {
        expect(env['LLXPRT_CONFIG_HOME']).toBe(origConfigHome);
        expect(args).toContain('opusthinking-claudecode');
        expect(args).toContain('tools.allowed=[]');
        const cacheHome = env['LLXPRT_CACHE_HOME'];
        if (cacheHome === undefined) throw new Error('cache home missing');
        expect(env['LLXPRT_LOG_HOME']).toBe(cacheHome);
        const sid = 'live-session';
        const dumpDir = path.join(cacheHome, 'dumps');
        const usageDir = path.join(
          cacheHome,
          'tmp',
          'project-hash',
          'token-usage',
        );
        fs.mkdirSync(dumpDir, { recursive: true });
        fs.mkdirSync(usageDir, { recursive: true });
        wj(path.join(dumpDir, 'live-request.json'), {
          provider: 'anthropic',
          timestamp: '',
          request: {
            url: 'https://api.anthropic.com/v1/messages',
            method: 'POST',
            body: {
              model: 'claude-opus-5',
              system: 'policy',
              messages: [{ role: 'user', content: corpusItem.prompt }],
              tools: [],
            },
          },
        });
        wjl(path.join(usageDir, `${sid}.jsonl`), [
          usageRow({ provider: 'anthropic', model: 'claude-opus-5' }),
        ]);
        return {
          stdout: JSON.stringify(
            {
              session_id: sid,
              response: 'OK',
              ...modelStats('claude-opus-5', 18166),
            },
            null,
            2,
          ),
          stderr: '',
          exitCode: 0,
        };
      },
    };
    await collect({
      resultsPath: rp,
      artifactsDir: path.join(dir, 'artifacts'),
      target: 'opusthinking',
      corpusId: 1,
      runner: fake,
    });
    const row = JSON.parse(fs.readFileSync(rp, 'utf-8'));
    expect(row.target).toBe('opusthinking');
    expect(row.model).toBe('claude-opus-5');
    expect(row.protocol).toBe('anthropic-messages');
    expect(row.endpointHost).toBe('api.anthropic.com');
    expect(row.charPrediction).toBe(row.requestChars / 4);
  });
});
