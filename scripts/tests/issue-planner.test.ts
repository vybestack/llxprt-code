/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  MARKER,
  buildIssueContext,
  buildPlanningInstructions,
  buildRelatedSearchQuery,
  ensureCommentBody,
  extractLinkedReferences,
  extractPlanFeedback,
  finalizeAgentOutput,
  reconcilePlanComment,
} from '../../.github/scripts/issue-planner.ts';
import {
  asNumber,
  asRecord,
  asRecordMap,
  asString,
  asVmFunction,
  asRecordArray,
  parseWorkflowYaml,
  asArray,
} from './typed-test-helpers.ts';
import type { FakeComment } from './typed-test-helpers.ts';

function asYamlStep(value: unknown): YamlStep {
  const rec = asRecord(value);
  const step: YamlStep = { ...rec };
  if (typeof rec['name'] === 'string') step.name = rec['name'];
  if (typeof rec['run'] === 'string') step.run = rec['run'];
  if (typeof rec['uses'] === 'string') step.uses = rec['uses'];
  if (typeof rec['id'] === 'string') step.id = rec['id'];
  if (typeof rec['if'] === 'string') step.if = rec['if'];
  if (
    rec['with'] !== undefined &&
    rec['with'] !== null &&
    typeof rec['with'] === 'object'
  ) {
    step.with = asRecord(rec['with']);
  }
  if (
    rec['env'] !== undefined &&
    rec['env'] !== null &&
    typeof rec['env'] === 'object'
  ) {
    const envRec = asRecord(rec['env']);
    const env: Record<string, string> = {};
    for (const key of Object.keys(envRec)) {
      env[key] = String(envRec[key]);
    }
    step.env = env;
  }
  return step;
}

function asYamlJob(value: unknown): YamlJob {
  const rec = asRecord(value);
  const job: YamlJob = {};
  if (Array.isArray(rec['steps'])) {
    job.steps = rec['steps'].map((s) => asYamlStep(s));
  }
  if (typeof rec['if'] === 'string') job.if = rec['if'];
  if (
    rec['env'] !== undefined &&
    rec['env'] !== null &&
    typeof rec['env'] === 'object'
  ) {
    const envRec = asRecord(rec['env']);
    const env: Record<string, string> = {};
    for (const key of Object.keys(envRec)) {
      env[key] = String(envRec[key]);
    }
    job.env = env;
  }
  if (typeof rec['concurrency'] === 'object' && rec['concurrency'] !== null) {
    const c = asRecord(rec['concurrency']);
    job.concurrency = {};
    if (typeof c['group'] === 'string') {
      job.concurrency.group = c['group'];
    }
    if (typeof c['cancel-in-progress'] === 'boolean') {
      job.concurrency['cancel-in-progress'] = c['cancel-in-progress'];
    }
  }
  return job;
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const HELPER = path.join(ROOT, '.github/scripts/issue-planner.ts');
const WORKFLOW_PATH = '.github/workflows/issue-planner.yml';
const THRESHOLD_SENTENCE =
  'Threshold decision: classify **small** ONLY when ALL of the following are true: <= 5 acceptance criteria, exactly one package spanned, no phase/epic signal, and expected net LoC < 500. Otherwise classify **large**.';

type YamlWorkflow = Record<string, unknown>;
type YamlJob = {
  steps?: YamlStep[];
  if?: string;
  env?: Record<string, string>;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  [key: string]: unknown;
};
type YamlStep = {
  name?: string;
  run?: string;
  with?: Record<string, unknown>;
  uses?: string;
  id?: string;
  if?: string;
  env?: Record<string, string>;
  [key: string]: unknown;
};

type FakeGitHubOptions = {
  hideCreatedLists?: number;
  ambiguousCreate?: boolean;
  ignoreUpdates?: boolean;
  failDeleteId?: number;
  failDeleteStatus?: number;
};

function loadWorkflow(): { source: string; workflow: YamlWorkflow } {
  const source = fs.readFileSync(path.join(ROOT, WORKFLOW_PATH), 'utf8');
  return { source, workflow: parseWorkflowYaml(source) };
}

function stepNamed(job: YamlJob | undefined, name: string): YamlStep {
  expect(job?.steps, `missing workflow job for step: ${name}`).toBeDefined();
  const step = job?.steps?.find(
    (candidate: YamlStep) => candidate.name === name,
  );
  expect(step, `missing workflow step: ${name}`).toBeTruthy();
  if (!step) throw new Error(`missing workflow step: ${name}`);
  return step;
}

function commandText(step: YamlStep | undefined): string {
  return String(step?.run ?? step?.with?.['script'] ?? '');
}

function normalize(value: string): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true });
  return dir;
}

function restoreWriteBits(root: string): void {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) restoreWriteBits(target);
    if (!entry.isSymbolicLink())
      fs.chmodSync(target, entry.isDirectory() ? 0o700 : 0o600);
  }
  fs.chmodSync(root, 0o700);
}

function removeTempDir(dir: string): void {
  restoreWriteBits(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeJson(
  dir: string,
  name: string,
  value: { number: number; title: string; body: string },
) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
}

function runCli(
  args: string[],
  options: { env?: Record<string, string | undefined> } = {},
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [HELPER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
}

function botComment(id: number, body = `${MARKER}\nold`): FakeComment {
  return {
    id,
    body,
    user: { login: 'github-actions[bot]', type: 'Bot' },
  };
}

function userComment(id: number, body = `${MARKER}\nuser-owned`): FakeComment {
  return { id, body, user: { login: 'octocat', type: 'User' } };
}

function makeFakeGitHub(
  initial: FakeComment[] = [],
  options: FakeGitHubOptions = {},
) {
  const state: {
    comments: FakeComment[];
    calls: { create: number; delete: number[]; list: number; update: number[] };
    nextId: number;
  } = {
    comments: initial.map((comment: FakeComment) => ({
      ...comment,
      user: { ...comment.user },
    })),
    calls: { create: 0, delete: [], list: 0, update: [] },
    nextId: 100,
  };
  const issues = {
    async listComments() {
      state.calls.list += 1;
      const visible: FakeComment[] = [];
      for (const comment of state.comments) {
        const hiddenLists = comment.hiddenLists ?? 0;
        if (hiddenLists > 0) {
          comment.hiddenLists = hiddenLists - 1;
        } else {
          visible.push(comment);
        }
      }
      return {
        data: visible.map(({ hiddenLists: _hidden, ...comment }) => ({
          ...comment,
        })),
      };
    },
    async createComment(opts: Record<string, unknown>) {
      const body = asString(opts['body']);
      state.calls.create += 1;
      state.comments.push({
        ...botComment(state.nextId++, body),
        hiddenLists: options.hideCreatedLists ?? 0,
      });
      if (options.ambiguousCreate)
        throw new Error('connection reset after create');
    },
    async updateComment(opts: Record<string, unknown>) {
      const id = asNumber(opts['comment_id']);
      const body = asString(opts['body']);
      state.calls.update.push(id);
      const comment = state.comments.find(
        (candidate: FakeComment) => candidate.id === id,
      );
      if (!comment) throw new Error(`missing comment ${id}`);
      if (!options.ignoreUpdates) comment.body = body;
    },
    async deleteComment(opts: Record<string, unknown>) {
      const id = asNumber(opts['comment_id']);
      state.calls.delete.push(id);
      if (options.failDeleteId === id) {
        const error = new Error(`cannot delete ${id}`);
        const status = options.failDeleteStatus ?? 500;
        Object.defineProperty(error, 'status', {
          value: status,
          writable: true,
          enumerable: true,
          configurable: true,
        });
        if (status === 404) {
          state.comments = state.comments.filter(
            (comment: FakeComment) => comment.id !== id,
          );
        }
        throw error;
      }
      state.comments = state.comments.filter(
        (comment: FakeComment) => comment.id !== id,
      );
    },
  };
  return {
    github: {
      rest: { issues },
      paginate: async (
        fn: unknown,
        opts: Record<string, unknown>,
      ): Promise<unknown[]> => {
        const method = asVmFunction(fn);
        const result = asRecord(await method(opts));
        return asArray(result['data']);
      },
    },
    state,
  };
}

const noWait = async (_ms: number): Promise<void> => {};
const markerMatches = (comments: FakeComment[]): FakeComment[] =>
  comments.filter(
    (comment: FakeComment) =>
      comment.user.login === 'github-actions[bot]' &&
      comment.body.includes(MARKER),
  );

describe('linked references and generated planning data', () => {
  it('deduplicates local references, skips qualified/fenced references, and caps at 20', () => {
    const refs = Array.from({ length: 25 }, (_, index) => `#${index + 1}`).join(
      ' ',
    );
    expect(
      extractLinkedReferences(
        `owner/repo#999 #1 ${refs}\n\`\`\`\n#888\n\`\`\`\n    #777`,
      ),
    ).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });

  it('preserves the complete issue body, including trailing constraints beyond 4,000 chars', () => {
    const trailing = 'TRAILING CONSTRAINT MUST SURVIVE';
    const body = `${'x'.repeat(4100)}\n${trailing}`;
    expect(
      buildIssueContext({ issue: { number: 2256, title: 'Planner', body } }),
    ).toContain(trailing);
  });

  it.each([
    [{ title: 'Missing number' }, 'number'],
    [{ number: 1 }, 'title'],
    [{ number: 1, title: '   ' }, 'title'],
  ])('rejects malformed required issue metadata: %s', (issue, field) => {
    expect(() => buildIssueContext({ issue })).toThrow(field);
  });

  it('documents the linked-reference cap in context and instructions', () => {
    expect(
      buildIssueContext({ issue: { number: 1, title: 'T', body: '' } }),
    ).toContain('20');
    expect(buildPlanningInstructions()).toContain('20');
  });

  it('contains the exact complete sizing threshold sentence', () => {
    expect(buildPlanningInstructions()).toContain(THRESHOLD_SENTENCE);
  });

  it('keeps feedback extraction strict and multiline', () => {
    expect(extractPlanFeedback('/plan focus\nthen verify')).toBe(
      'focus\nthen verify',
    );
    expect(extractPlanFeedback('/plan\tfocus')).toBe('focus');
    expect(extractPlanFeedback('/planning nope')).toBeNull();
    expect(extractPlanFeedback('/Plan nope')).toBeNull();
    expect(extractPlanFeedback('/plan   ')).toBeNull();
    expect(extractPlanFeedback(null)).toBeNull();
  });
});

describe('buildRelatedSearchQuery', () => {
  it('strips metacharacters and #NNN references from a realistic title', () => {
    const result = buildRelatedSearchQuery(
      'Remove all Vitest escape hatches: scripts, configs, deps, lint plugin, and CI guard (#2578)',
    );
    expect(result).toContain('Remove');
    expect(result).toContain('Vitest');
    for (const forbidden of [':', ',', '(', ')', '#', '2578', '"']) {
      expect(result).not.toContain(forbidden);
    }
  });

  it('removes inline and trailing #NNN references', () => {
    const result = buildRelatedSearchQuery('Fix #123 crash (#456)');
    expect(result).not.toContain('123');
    expect(result).not.toContain('456');
    expect(result).not.toContain('#');
  });

  it('preserves numeric tokens and folds diacritics to ASCII', () => {
    expect(buildRelatedSearchQuery('Fix 123 crash')).toBe('Fix 123 crash');
    expect(buildRelatedSearchQuery('café bug')).toBe('cafe bug');
  });

  it('de-duplicates tokens case-insensitively', () => {
    const result = buildRelatedSearchQuery('Foo foo FOO bar');
    expect(result.split(' ')).toEqual(['Foo', 'bar']);
  });

  it('caps the keyword count at 10', () => {
    const result = buildRelatedSearchQuery(
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen',
    );
    expect(result.split(' ')).toHaveLength(10);
  });

  it('drops tokens shorter than two characters', () => {
    expect(buildRelatedSearchQuery('a b cd ef')).toBe('cd ef');
  });

  it.each(['', '### (:,)'])(
    'returns an empty string for empty or all-metacharacter input: %s',
    (title) => {
      expect(buildRelatedSearchQuery(title)).toBe('');
    },
  );
});

describe('finalizeAgentOutput', () => {
  it('normalizes a valid plan to one leading marker', () => {
    const result = finalizeAgentOutput(`${MARKER}\n# Plan\n${MARKER}\nbody`);
    expect(result).toBe(`${MARKER}\n# Plan\n\nbody`);
    expect(result.match(new RegExp(MARKER, 'g'))).toHaveLength(1);
  });

  it.each(['', ' \n ', MARKER, `${MARKER}\n  `])(
    'rejects empty and marker-only output %#',
    (output) => expect(() => finalizeAgentOutput(output)).toThrow(),
  );

  it('rejects output over the GitHub comment limit', () => {
    expect(() => finalizeAgentOutput('x'.repeat(65_536))).toThrow(/65,536/);
  });

  it.each(['@plan: phase one', '# Plan\n@requirement: REQ-1'])(
    'rejects on-disk directive syntax: %s',
    (output) => expect(() => finalizeAgentOutput(output)).toThrow(/directive/i),
  );

  it('does not perform semantic Markdown validation', () => {
    expect(finalizeAgentOutput('plain but nonempty plan')).toContain(
      'plain but nonempty plan',
    );
  });

  it.each(['', null, undefined])(
    'supplies a marker-bearing infrastructure body for empty comments',
    (body) => {
      expect(ensureCommentBody(body)).toMatch(
        /^<!-- llxprt-issue-plan -->\n.*infrastructure/is,
      );
    },
  );
});

describe('real issue-planner CLI entrypoint', () => {
  const readOut = (dir: string, name: string): string =>
    fs.readFileSync(path.join(dir, name), 'utf8');

  it('runs linked-reference mode and excludes the current issue', () => {
    const dir = makeTempDir('planner-cli-refs-');
    try {
      writeJson(dir, 'issue.json', {
        number: 3,
        title: 'T',
        body: '#3 #4 owner/repo#5 #4\n```\n#6\n```',
      });
      const result = runCli(['--extract-linked-references', dir, '3']);
      expect(result.status ?? -1, String(result.stderr ?? '')).toBe(0);
      expect(readOut(dir, 'linked-references.txt')).toBe('4');
    } finally {
      removeTempDir(dir);
    }
  });

  it('rejects linked-reference mode without a current issue number', () => {
    const dir = makeTempDir('planner-cli-refs-missing-current-');
    try {
      writeJson(dir, 'issue.json', { number: 3, title: 'T', body: '#3 #4' });
      const result = runCli(['--extract-linked-references', dir]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/current issue/i);
    } finally {
      removeTempDir(dir);
    }
  });

  it('runs context and instruction modes and preserves long issue bodies', () => {
    const dir = makeTempDir('planner-cli-render-');
    try {
      const trailing = 'constraint after four thousand characters';
      writeJson(dir, 'issue.json', {
        number: 8,
        title: 'Long issue',
        body: `${'a'.repeat(4100)}${trailing}`,
      });
      fs.mkdirSync(path.join(dir, 'issues', 'not-a-file.json'));
      const context = runCli(['--render-context', dir]);
      const instructions = runCli(['--render-instructions', dir]);
      expect(context.status ?? -1, String(context.stderr ?? '')).toBe(0);
      expect(instructions.status ?? -1, String(instructions.stderr ?? '')).toBe(
        0,
      );
      expect(readOut(dir, 'issue-context.md')).toContain(trailing);
      expect(
        fs.readFileSync(path.join(dir, 'planning-instructions.md'), 'utf8'),
      ).toContain(THRESHOLD_SENTENCE);
    } finally {
      removeTempDir(dir);
    }
  });

  it('identifies the malformed JSON artifact in CLI errors', () => {
    const dir = makeTempDir('planner-cli-invalid-json-');
    try {
      writeJson(dir, 'issue.json', { number: 8, title: 'T', body: '' });
      const brokenPath = path.join(dir, 'issues', 'broken.json');
      fs.writeFileSync(brokenPath, '{');
      const result = runCli(['--render-context', dir]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(brokenPath);
    } finally {
      removeTempDir(dir);
    }
  });

  it('runs feedback mode using the shared planner directory contract', () => {
    const dir = makeTempDir('planner-cli-feedback-');
    try {
      const result = runCli(['--extract-feedback', dir], {
        env: { COMMENT_BODY: '/plan retain this feedback' },
      });
      expect(result.status ?? -1, String(result.stderr ?? '')).toBe(0);
      expect(readOut(dir, 'feedback.txt')).toBe('retain this feedback');
    } finally {
      removeTempDir(dir);
    }
  });

  it('runs finalize mode', () => {
    const dir = makeTempDir('planner-cli-finalize-');
    try {
      fs.writeFileSync(path.join(dir, 'plan.md'), '# Concrete plan');
      const result = runCli(['--finalize', dir]);
      expect(result.status ?? -1, String(result.stderr ?? '')).toBe(0);
      expect(readOut(dir, 'comment.md')).toBe(`${MARKER}\n# Concrete plan`);
    } finally {
      removeTempDir(dir);
    }
  });

  it('writes a search-safe query for a metacharacter title via --build-search-query', () => {
    const dir = makeTempDir('planner-cli-search-query-');
    try {
      writeJson(dir, 'issue.json', {
        number: 11,
        title: 'Escape hatches: configs, deps (#2578)',
        body: '',
      });
      const result = runCli(['--build-search-query', dir]);
      expect(result.status ?? -1, String(result.stderr ?? '')).toBe(0);
      const query = readOut(dir, 'search-query.txt');
      for (const forbidden of [':', ',', '(', ')', '#', '2578']) {
        expect(query).not.toContain(forbidden);
      }
      expect(query).toContain('Escape');
      expect(query).toContain('hatches');
    } finally {
      removeTempDir(dir);
    }
  });

  it('rejects --build-search-query when issue.json is absent', () => {
    const dir = makeTempDir('planner-cli-search-query-missing-');
    try {
      const result = runCli(['--build-search-query', dir]);
      expect(result.status ?? -1).not.toBe(0);
      expect(result.stderr).toMatch(/issue\.json/i);
    } finally {
      removeTempDir(dir);
    }
  });

  it('prints an error and exits nonzero for an invalid mode', () => {
    const result = runCli(['--not-a-mode', 'planner']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unknown mode');
  });
});

type FakeGitHub = ReturnType<typeof makeFakeGitHub>;

describe('reconcilePlanComment with stateful GitHub infrastructure', () => {
  async function reconcile(fake: FakeGitHub, body = `${MARKER}\nnew`) {
    return reconcilePlanComment({
      github: fake.github,
      owner: 'owner',
      repo: 'repo',
      issueNumber: 2256,
      body,
      sleep: noWait,
    });
  }

  it('creates one bot marker comment', async () => {
    const fake = makeFakeGitHub();
    await reconcile(fake);
    expect(fake.state.calls.create).toBe(1);
    expect(markerMatches(fake.state.comments)).toHaveLength(1);
  });

  it('updates an existing bot marker comment', async () => {
    const fake = makeFakeGitHub([botComment(1)]);
    await reconcile(fake);
    expect(fake.state.calls.create).toBe(0);
    expect(fake.state.comments[0].body).toBe(`${MARKER}\nnew`);
  });

  it('preserves a user marker comment and creates a separate bot comment', async () => {
    const fake = makeFakeGitHub([userComment(9)]);
    await reconcile(fake);
    expect(
      fake.state.comments.find((comment) => comment.id === 9)?.body,
    ).toContain('user-owned');
    expect(markerMatches(fake.state.comments)).toHaveLength(1);
  });

  it('deletes duplicate bot comments and leaves exactly one exact body', async () => {
    const fake = makeFakeGitHub([botComment(1), botComment(2), userComment(3)]);
    await reconcile(fake);
    expect(fake.state.calls.delete).toEqual([2]);
    expect(markerMatches(fake.state.comments)).toEqual([
      expect.objectContaining({ id: 1, body: `${MARKER}\nnew` }),
    ]);
  });

  it('recovers from an ambiguous create that committed before throwing', async () => {
    const fake = makeFakeGitHub([], { ambiguousCreate: true });
    await reconcile(fake);
    expect(fake.state.calls.create).toBe(1);
    expect(markerMatches(fake.state.comments)).toHaveLength(1);
  });

  it('uses bounded re-listing when a created comment has delayed visibility', async () => {
    const fake = makeFakeGitHub([], { hideCreatedLists: 2 });
    await reconcile(fake);
    expect(fake.state.calls.list).toBeGreaterThanOrEqual(4);
    expect(fake.state.calls.list).toBeLessThanOrEqual(7);
    expect(markerMatches(fake.state.comments)).toHaveLength(1);
  });

  it('treats a duplicate delete 404 as already converged', async () => {
    const fake = makeFakeGitHub([botComment(1), botComment(2)], {
      failDeleteId: 2,
      failDeleteStatus: 404,
    });
    await reconcile(fake);
    expect(markerMatches(fake.state.comments)).toHaveLength(1);
  });

  it('fails fast when deleting a duplicate fails', async () => {
    const fake = makeFakeGitHub([botComment(1), botComment(2)], {
      failDeleteId: 2,
    });
    await expect(reconcile(fake)).rejects.toThrow('cannot delete 2');
  });

  it('throws when final state does not contain one exact bot body', async () => {
    const fake = makeFakeGitHub([botComment(1)], { ignoreUpdates: true });
    await expect(reconcile(fake)).rejects.toThrow(/exactly one/i);
  });
});

describe('.github/workflows/issue-planner.yml', () => {
  const { source, workflow } = loadWorkflow();
  const jobs = asRecordMap(workflow['jobs']);
  const planJob = asYamlJob(jobs['plan']);
  const on = asRecord(workflow['on']);
  const permissions = asRecord(workflow['permissions']);

  it('uses intended triggers, least privilege, trusted /plan gating, and per-issue concurrency', () => {
    expect(asRecord(on['issues']).types).toEqual([
      'opened',
      'edited',
      'reopened',
      'labeled',
    ]);
    expect(asRecord(on['issue_comment']).types).toEqual(['created']);
    expect(permissions).toEqual({ contents: 'read', issues: 'write' });
    expect(normalize(asString(planJob['if']))).toContain("'COLLABORATOR'");
    expect(normalize(asString(planJob['if']))).toContain(
      'github.event.issue.pull_request == null',
    );
    expect(
      normalize(asString(asRecord(planJob['concurrency'])?.['group'])),
    ).toContain('github.event.issue.number');
  });

  it('collapses duplicate issue triggers with cancel-in-progress: true (#2972)', () => {
    const concurrency = asRecord(planJob.concurrency);
    expect(concurrency['cancel-in-progress']).toBe(true);
  });

  it('pins only first-party actions and scopes sensitive inputs', () => {
    const uses = (planJob.steps ?? [])
      .map((step: YamlStep) => step.uses)
      .filter((u: unknown): u is string => typeof u === 'string');
    expect(uses).toEqual([
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
      'actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3',
    ]);
    expect(planJob.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(planJob.env).not.toHaveProperty('COMMENT_BODY');
    const secretSteps = (planJob.steps ?? []).filter((step: YamlStep) =>
      JSON.stringify(step).includes('secrets'),
    );
    expect(secretSteps).toHaveLength(1);
    expect(commandText(secretSteps[0])).toContain('ci-quota-check.ts');
    const validation = commandText(
      stepNamed(planJob, 'Validate required repository variables'),
    );
    for (const name of [
      'PLANNER_KEY_VAR_NAME',
      'PLANNER_BASE_URL',
      'PLANNER_MODEL',
      'PLANNER_PROVIDER',
    ]) {
      expect(validation).toContain(`${name}:?`);
    }
  });

  it('uses fail-fast pruned confinement and verifies no write bits remain', () => {
    const script = commandText(
      stepNamed(planJob, 'Confine filesystem for planner agent'),
    );
    expect(script).toContain('-prune');
    expect(script).not.toContain('|| true');
    expect(script).not.toContain('2>/dev/null');
    expect(script).toContain('remaining_writable');
  });

  it('filters self and confines title search to the current repository', () => {
    const script = commandText(
      stepNamed(planJob, 'Precompute related PRs/issues candidates'),
    );
    expect(script).toMatch(/select\(\.number != \$issue_number\)/);
    expect(script).toContain('--argjson issue_number "${ISSUE_NUMBER}"');
    expect(script).toContain('--repo "${REPO}"');
    expect(script).not.toContain('repo:${REPO}');
  });

  it('makes related-candidate precompute best-effort and never interpolates the title (#2972)', () => {
    const script = commandText(
      stepNamed(planJob, 'Precompute related PRs/issues candidates'),
    );
    expect(script).toContain('--build-search-query');
    expect(script).toContain('search-query.txt');
    expect(script).toContain('::warning::');
    expect(script).toMatch(/if ! gh search/);
    expect(script).not.toMatch(/\$\{issue_title\}/);
    // These exact-syntax assertions encode the #2972 defect contract, not
    // incidental implementation detail: the quoted expansion prevents the
    // word-split that silently zeroed the candidate list, and `if !` makes the
    // advisory step non-fatal. They follow this file's convention for bash
    // run-script regression guards (see the confinement `-prune`/`|| true` and
    // `--merged` tests). There is no behavioral abstraction here: `gh` is not
    // available in the test environment, so the run-script text IS the contract.
    // The keyword query is passed as one quoted positional argument: gh search
    // takes a single query, so an unquoted expansion word-splits into extra
    // positional args and errors, silently zeroing the candidate list (#2972).
    expect(script).toContain('gh search prs "${search_query}"');
    expect(script).toContain('gh search issues "${search_query}"');
    // The helper invocation is itself advisory and must not abort the run.
    expect(script).toMatch(/if ! bun .*--build-search-query/);
  });

  it('uses the gh search prs --merged flag, never the invalid --state merged (#2747)', () => {
    const script = commandText(
      stepNamed(planJob, 'Precompute related PRs/issues candidates'),
    );
    // Regression guard: `gh search prs --state merged` is invalid (the
    // --state flag only accepts open|closed) and caused a 100% workflow
    // failure rate. The correct flag is the boolean --merged.
    expect(script).not.toContain('--state merged');
    expect(script).toContain('--merged');
  });

  it('delegates reconciliation to the helper and catches failures with core.setFailed', () => {
    const script = commandText(stepNamed(planJob, 'Upsert plan comment'));
    expect(script).toContain('reconcilePlanComment');
    expect(script).toContain('await reconcilePlanComment');
    expect(script).toContain('core.setFailed');
    expect(script).not.toContain('github.paginate');
    expect(script).not.toContain('updateComment');
    expect(script).not.toContain('deleteComment');
    expect(script).not.toContain('createComment');
  });

  it('assigns agent/upsert IDs and reports success only when both outcomes succeeded', () => {
    const agent = stepNamed(planJob, 'Run planner agent');
    const upsert = stepNamed(planJob, 'Upsert plan comment');
    const report = stepNamed(planJob, 'Report planner outcome');
    expect(agent.id).toBeTruthy();
    expect(upsert.id).toBeTruthy();
    expect(report.env?.['PLANNER_OUTCOME']).toContain(
      `steps.${agent.id}.outcome`,
    );
    expect(report.env?.['UPSERT_OUTCOME']).toContain(
      `steps.${upsert.id}.outcome`,
    );
    const script = commandText(report);
    expect(script).toMatch(
      /PLANNER_OUTCOME.*success.*UPSERT_OUTCOME.*success/s,
    );
    expect(script).toMatch(/planner.*fail/i);
    expect(script).toMatch(/post|comment/i);
  });

  it('keeps the agent tool boundary, failure comment, and API-key cleanup', () => {
    const script = commandText(stepNamed(planJob, 'Run planner agent'));
    expect(script).toContain('--allowed-tools');
    expect(script).toContain('read_file');
    expect(script).toContain('write_file');
    expect(script).not.toContain('run_shell_command');
    expect(script).toContain('infrastructure failure');
    const cleanup = stepNamed(planJob, 'Clear selected API key');
    expect(cleanup['if']).toBe('always()');
    expect(commandText(cleanup)).toContain('OPENAI_API_KEY=');
  });

  it('uses planner-specific provider/model/baseurl env vars in the agent step (#2747)', () => {
    const script = commandText(stepNamed(planJob, 'Run planner agent'));
    // The agent must read the planner-specific overrides, not the shared CI
    // defaults, so a stronger model can be configured via repo vars.
    expect(script).toContain('--provider "${PLANNER_PROVIDER}"');
    expect(script).toContain('--model "${PLANNER_MODEL}"');
    expect(script).toContain('--baseurl "${PLANNER_BASE_URL}"');
    expect(script).not.toContain('LLXPRT_DEFAULT_PROVIDER');
    expect(script).not.toContain('LLXPRT_DEFAULT_MODEL');
    expect(script).not.toContain('OPENAI_BASE_URL');
  });

  it('resolves planner-specific keys with fallback to shared CI keys (#2747)', () => {
    const quota = stepNamed(planJob, 'Check API quota and select optimal key');
    const script = JSON.stringify(quota);
    // The quota step must prefer planner-specific key vars, falling back to
    // the shared CI defaults when planner-specific vars are unset.
    expect(script).toContain('secrets[vars.PLANNER_KEY_VAR_NAME]');
    expect(script).toContain('secrets[vars.KEY_VAR_NAME]');
    expect(script).toContain('env.PLANNER_KEY_VAR_NAME');
  });

  it('uses the production CLI for reference extraction without suppressing feedback failures', () => {
    expect(
      commandText(
        stepNamed(planJob, 'Extract linked references and fetch linked issues'),
      ),
    ).toContain('--extract-linked-references');
    expect(
      normalize(commandText(stepNamed(planJob, 'Extract /plan feedback'))),
    ).not.toContain('|| true');
  });

  it('does not add semantic validation, general comment collection, or third-party actions', () => {
    expect(source).not.toContain('planner/comments.json');
    expect(source).not.toContain('markdown-it');
    expect(
      asRecordArray(planJob.steps ?? []).filter(
        (step: YamlStep) =>
          step.uses &&
          !step.uses.startsWith('actions/') &&
          !step.uses.startsWith('oven-sh/'),
      ),
    ).toEqual([]);
  });
});
