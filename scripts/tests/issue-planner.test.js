/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import {
  MARKER,
  buildIssueContext,
  buildPlanningInstructions,
  ensureCommentBody,
  extractLinkedReferences,
  extractPlanFeedback,
  finalizeAgentOutput,
  reconcilePlanComment,
} from '../../.github/scripts/issue-planner.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const HELPER = path.join(ROOT, '.github/scripts/issue-planner.mjs');
const WORKFLOW_PATH = '.github/workflows/issue-planner.yml';
const THRESHOLD_SENTENCE =
  'Threshold decision: classify **small** ONLY when ALL of the following are true: <= 5 acceptance criteria, exactly one package spanned, no phase/epic signal, and expected net LoC < 500. Otherwise classify **large**.';

function loadWorkflow() {
  const source = fs.readFileSync(path.join(ROOT, WORKFLOW_PATH), 'utf8');
  return { source, workflow: yaml.load(source) };
}

function stepNamed(job, name) {
  const step = job.steps.find((candidate) => candidate.name === name);
  expect(step, `missing workflow step: ${name}`).toBeTruthy();
  return step;
}

function commandText(step) {
  return String(step?.run ?? step?.with?.script ?? '');
}

function normalize(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, 'issues'), { recursive: true });
  return dir;
}

function restoreWriteBits(root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) restoreWriteBits(target);
    if (!entry.isSymbolicLink())
      fs.chmodSync(target, entry.isDirectory() ? 0o700 : 0o600);
  }
  fs.chmodSync(root, 0o700);
}

function removeTempDir(dir) {
  restoreWriteBits(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeJson(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [HELPER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
}

function botComment(id, body = `${MARKER}\nold`) {
  return {
    id,
    body,
    user: { login: 'github-actions[bot]', type: 'Bot' },
  };
}

function userComment(id, body = `${MARKER}\nuser-owned`) {
  return { id, body, user: { login: 'octocat', type: 'User' } };
}

function makeFakeGitHub(initial = [], options = {}) {
  const state = {
    comments: initial.map((comment) => ({
      ...comment,
      user: { ...comment.user },
    })),
    calls: { create: 0, delete: [], list: 0, update: [] },
    nextId: 100,
  };
  const issues = {
    async listComments() {
      state.calls.list += 1;
      const visible = [];
      for (const comment of state.comments) {
        if ((comment.hiddenLists ?? 0) > 0) {
          comment.hiddenLists -= 1;
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
    async createComment({ body }) {
      state.calls.create += 1;
      state.comments.push({
        ...botComment(state.nextId++, body),
        hiddenLists: options.hideCreatedLists ?? 0,
      });
      if (options.ambiguousCreate)
        throw new Error('connection reset after create');
    },
    async updateComment({ comment_id: id, body }) {
      state.calls.update.push(id);
      const comment = state.comments.find((candidate) => candidate.id === id);
      if (!comment) throw new Error(`missing comment ${id}`);
      if (!options.ignoreUpdates) comment.body = body;
    },
    async deleteComment({ comment_id: id }) {
      state.calls.delete.push(id);
      if (options.failDeleteId === id) {
        const error = new Error(`cannot delete ${id}`);
        error.status = options.failDeleteStatus ?? 500;
        if (error.status === 404) {
          state.comments = state.comments.filter(
            (comment) => comment.id !== id,
          );
        }
        throw error;
      }
      state.comments = state.comments.filter((comment) => comment.id !== id);
    },
  };
  return {
    github: {
      rest: { issues },
      paginate: async (method, params) => (await method(params)).data,
    },
    state,
  };
}

const noWait = async () => {};
const markerMatches = (comments) =>
  comments.filter(
    (comment) =>
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
        `owner/repo#999 #1 ${refs}\n\`\`\`\n#888\n\`\`\``,
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
  it('runs linked-reference mode and excludes the current issue', () => {
    const dir = makeTempDir('planner-cli-refs-');
    try {
      writeJson(dir, 'issue.json', {
        number: 3,
        title: 'T',
        body: '#3 #4 owner/repo#5 #4\n```\n#6\n```',
      });
      const result = runCli(['--extract-linked-references', dir, '3']);
      expect(result.status, result.stderr).toBe(0);
      expect(
        fs.readFileSync(path.join(dir, 'linked-references.txt'), 'utf8'),
      ).toBe('4');
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
      const context = runCli(['--render-context', dir]);
      const instructions = runCli(['--render-instructions', dir]);
      expect(context.status, context.stderr).toBe(0);
      expect(instructions.status, instructions.stderr).toBe(0);
      expect(
        fs.readFileSync(path.join(dir, 'issue-context.md'), 'utf8'),
      ).toContain(trailing);
      expect(
        fs.readFileSync(path.join(dir, 'planning-instructions.md'), 'utf8'),
      ).toContain(THRESHOLD_SENTENCE);
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
      expect(result.status, result.stderr).toBe(0);
      expect(fs.readFileSync(path.join(dir, 'feedback.txt'), 'utf8')).toBe(
        'retain this feedback',
      );
    } finally {
      removeTempDir(dir);
    }
  });

  it('runs finalize mode', () => {
    const dir = makeTempDir('planner-cli-finalize-');
    try {
      fs.writeFileSync(path.join(dir, 'plan.md'), '# Concrete plan');
      const result = runCli(['--finalize', dir]);
      expect(result.status, result.stderr).toBe(0);
      expect(fs.readFileSync(path.join(dir, 'comment.md'), 'utf8')).toBe(
        `${MARKER}\n# Concrete plan`,
      );
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

describe('reconcilePlanComment with stateful GitHub infrastructure', () => {
  async function reconcile(fake, body = `${MARKER}\nnew`) {
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
  const planJob = workflow.jobs.plan;

  it('uses intended triggers, least privilege, trusted /plan gating, and per-issue concurrency', () => {
    expect(workflow.on.issues.types).toEqual([
      'opened',
      'edited',
      'reopened',
      'labeled',
    ]);
    expect(workflow.on.issue_comment.types).toEqual(['created']);
    expect(workflow.permissions).toEqual({ contents: 'read', issues: 'write' });
    expect(normalize(planJob.if)).toContain("'COLLABORATOR'");
    expect(normalize(planJob.if)).toContain(
      'github.event.issue.pull_request == null',
    );
    expect(normalize(planJob.concurrency.group)).toContain(
      'github.event.issue.number',
    );
  });

  it('pins only first-party actions and scopes sensitive inputs', () => {
    const uses = planJob.steps.map((step) => step.uses).filter(Boolean);
    expect(uses).toEqual([
      'actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8',
      'actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b',
    ]);
    expect(planJob.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(planJob.env).not.toHaveProperty('COMMENT_BODY');
    const secretSteps = planJob.steps.filter((step) =>
      JSON.stringify(step).includes('secrets'),
    );
    expect(secretSteps).toHaveLength(1);
    expect(commandText(secretSteps[0])).toContain('ci-quota-check.js');
    const validation = commandText(
      stepNamed(planJob, 'Validate required repository variables'),
    );
    for (const name of [
      'KEY_VAR_NAME',
      'OPENAI_BASE_URL',
      'LLXPRT_DEFAULT_MODEL',
      'LLXPRT_DEFAULT_PROVIDER',
    ]) {
      expect(validation).toContain(`${name}:?`);
    }
  });

  it('behaviorally confines all non-planner/.git paths and restores modes in finally', () => {
    const dir = makeTempDir('planner-confinement-');
    const confine = stepNamed(planJob, 'Confine filesystem for planner agent');
    try {
      fs.mkdirSync(path.join(dir, '.git'));
      fs.mkdirSync(path.join(dir, 'planner'));
      fs.mkdirSync(path.join(dir, 'src', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.git', 'state'), 'git');
      fs.writeFileSync(path.join(dir, 'planner', 'plan.md'), 'plan');
      fs.writeFileSync(path.join(dir, 'src', 'nested', 'code.js'), 'code');
      const result = spawnSync('bash', ['-c', commandText(confine)], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      for (const target of ['.', 'src', 'src/nested', 'src/nested/code.js']) {
        expect(fs.statSync(path.join(dir, target)).mode & 0o222, target).toBe(
          0,
        );
      }
      expect(fs.statSync(path.join(dir, 'planner')).mode & 0o200).toBe(0o200);
      expect(fs.statSync(path.join(dir, '.git')).mode & 0o200).toBe(0o200);
    } finally {
      removeTempDir(dir);
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
    expect(script).toContain('search_query="\\"${issue_title}\\""');
    expect(script).not.toContain('repo:${REPO}');
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
    expect(report.env.PLANNER_OUTCOME).toContain(`steps.${agent.id}.outcome`);
    expect(report.env.UPSERT_OUTCOME).toContain(`steps.${upsert.id}.outcome`);
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
    expect(cleanup.if).toBe('always()');
    expect(commandText(cleanup)).toContain('OPENAI_API_KEY=');
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
      planJob.steps.filter(
        (step) => step.uses && !step.uses.startsWith('actions/'),
      ),
    ).toEqual([]);
  });
});
