/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  asOptionalRecord,
  asRecord,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';
import type { WorkflowJob, WorkflowStep } from './typed-test-helpers.ts';
import {
  WORKFLOW_PATH,
  commandText,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';

// ---------------------------------------------------------------------------
// Canonical snippet extraction
// ---------------------------------------------------------------------------

function readCanonicalSnippet(
  modulePath: string,
  beginSentinel: string,
  endSentinel: string,
): string {
  const content = readRootFile(modulePath);
  const beginIdx = content.indexOf(beginSentinel);
  const endIdx = content.indexOf(endSentinel);
  expect(
    beginIdx,
    `${beginSentinel} should exist in ${modulePath}`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    endIdx,
    `${endSentinel} should exist in ${modulePath}`,
  ).toBeGreaterThan(beginIdx);
  return content.slice(beginIdx, endIdx + endSentinel.length);
}

function loadWorkflow(): { yml: string; parsed: Record<string, unknown> } {
  const yml = readRootFile(WORKFLOW_PATH);
  const parsed = parseWorkflowYaml(yml);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${WORKFLOW_PATH} did not parse to a YAML mapping`);
  }
  return { yml, parsed };
}

function getCodeReviewJob(): WorkflowJob {
  const { parsed } = loadWorkflow();
  const jobs = asOptionalRecord(asRecord(parsed)['jobs']);
  const job = asOptionalRecord(jobs?.['code-review']);
  if (!job) throw new Error('workflow should define code-review job');
  return job;
}

describe('ocr-canary-metrics.cjs — verbatim embedding in workflow (AM1 pattern)', () => {
  it('Build OCR canary metrics step contains the canonical snippet verbatim', () => {
    const job = getCodeReviewJob();
    const script = commandText(stepNamed(job, 'Build OCR canary metrics'));
    const canonical = readCanonicalSnippet(
      '.github/scripts/ocr-canary-metrics.cjs',
      '// --- BEGIN OCR CANARY METRICS SNIPPET ---',
      '// --- END OCR CANARY METRICS SNIPPET ---',
    );
    expect(
      script,
      'Build OCR canary metrics step must embed the canonical snippet ' +
        'from .github/scripts/ocr-canary-metrics.cjs verbatim. ' +
        'Re-embed: copy the text between (and including) the BEGIN/END ' +
        'sentinels into the step script, indenting every line uniformly to ' +
        'match the surrounding block (12 spaces at the time of writing). ' +
        'The comparison runs against the YAML-parsed script, which strips ' +
        'the block scalar indentation, so only inconsistent indentation ' +
        'breaks this assertion.',
    ).toContain(canonical);
  });
});

describe('ocr-review-context.cjs — verbatim embedding in workflow (AM1 pattern)', () => {
  it('Resolve effective review context step contains the canonical snippet verbatim', () => {
    const job = getCodeReviewJob();
    const script = commandText(
      stepNamed(job, 'Resolve effective review context'),
    );
    const canonical = readCanonicalSnippet(
      '.github/scripts/ocr-review-context.cjs',
      '// --- BEGIN OCR REVIEW CONTEXT SNIPPET ---',
      '// --- END OCR REVIEW CONTEXT SNIPPET ---',
    );
    expect(
      script,
      'Resolve effective review context step must embed the canonical ' +
        'snippet from .github/scripts/ocr-review-context.cjs verbatim. ' +
        'Re-embed: copy the text between (and including) the BEGIN/END ' +
        'sentinels into the step script, indenting every line uniformly to ' +
        'match the surrounding block (12 spaces at the time of writing). ' +
        'The comparison runs against the YAML-parsed script, which strips ' +
        'the block scalar indentation, so only inconsistent indentation ' +
        'breaks this assertion.',
    ).toContain(canonical);
  });
});

// ---------------------------------------------------------------------------
// Fork-safety regression tests
// ---------------------------------------------------------------------------

describe('fork-safety — canary and review-context steps never require PR-head scripts', () => {
  it('Build OCR canary metrics step does not require() a repo-relative script path', () => {
    const job = getCodeReviewJob();
    const script = commandText(stepNamed(job, 'Build OCR canary metrics'));
    expect(
      script,
      'Build OCR canary metrics must not require() a repo-relative script',
    ).not.toMatch(/require\(['"]\.\/|require\(['"]\.\.\//);
    expect(
      script,
      'Build OCR canary metrics must not require() a bare script filename',
    ).not.toMatch(/require\(['"][a-zA-Z0-9_-]+\.c?js['"]\)/);
  });

  it('Resolve effective review context step does not require() a repo-relative script path', () => {
    const job = getCodeReviewJob();
    const script = commandText(
      stepNamed(job, 'Resolve effective review context'),
    );
    expect(
      script,
      'Resolve effective review context must not require() a repo-relative script',
    ).not.toMatch(/require\(['"]\.\/|require\(['"]\.\.\//);
    expect(
      script,
      'Resolve effective review context must not require() a bare script filename',
    ).not.toMatch(/require\(['"][a-zA-Z0-9_-]+\.c?js['"]\)/);
  });

  it('code-review job run steps never invoke node/bun against a repo-relative script file', () => {
    const job = getCodeReviewJob();
    const steps = job.steps ?? [];
    // The working tree is always the trusted base (checked out first), so
    // running trusted repo scripts like `bun scripts/ocr-telemetry.ts` is
    // safe. The fork-safety concern is running node/bun against scripts that
    // could come from the PR head — which requires the working tree to be
    // switched, or paths constructed dynamically from PR-head data.
    //
    // Safe invocation patterns:
    //   node <<'NODE' / bun <<'BUN'     — inline heredoc (trusted)
    //   node -e '...' / bun -e '...'    — inline eval (trusted)
    //   node ocr-*.cjs                  — heredoc-generated file (trusted)
    //   bun scripts/*.ts                — trusted base repo script
    //
    // The dangerous pattern is node/bun against a dynamically-constructed
    // path that could resolve to PR-head code — e.g. variable interpolation
    // in the script path.
    for (const step of steps) {
      const run = commandText(step);
      for (const line of run.split('\n')) {
        const invocation = line.match(/^\s*(node|bun)\s+(.+)/);
        if (!invocation) continue;
        const args = invocation[2].trim();
        // Flag only if the script path contains shell variable interpolation
        // (could resolve to a PR-head path).
        expect(
          /^(?:<<|-e\b|ocr-[\w-]+\.c?js|scripts\/\S+\.ts|["'].*["']|'$)/.test(
            args,
          ),
          `code-review job step "${stepLabel(step)}" invokes node/bun with an ` +
            `unrecognized argument pattern: "${invocation[0].trim()}". ` +
            'If this is a trusted script, add it to the safe-pattern list.',
        ).toBe(true);
      }
    }
  });

  it('code-review job run steps never load modules via dynamic path/cwd/__dirname + require/import', () => {
    const job = getCodeReviewJob();
    const steps = job.steps ?? [];
    // Dynamic module loading from runtime-constructed paths (path.join,
    // process.cwd(), __dirname) can load PR-head code if the working tree
    // were ever switched to the PR head. This is a fork-safety violation.
    const dynamicLoadPattern =
      /(?:path\.join|process\.cwd|__dirname)\s*\([^)]*\)\s*[,)]\s*(?:require|import)/;
    for (const step of steps) {
      const run = commandText(step);
      expect(
        run,
        `code-review job step "${stepLabel(step)}" must not dynamically require/import ` +
          'a module constructed from path.join/process.cwd()/__dirname.',
      ).not.toMatch(dynamicLoadPattern);
    }
  });

  it('workflow never checks out, switches to, or creates a worktree from the PR head ref', () => {
    const { yml } = loadWorkflow();
    // The PR head is only fetched into a bare ref (pr-head), never checked
    // out, switched to, or used as a worktree base. These git commands would
    // make PR-supplied files appear in the working tree.
    const gitCheckoutHeadPattern = /git\s+(?:checkout|switch|worktree\s+add)\b/;
    const checkoutLines = yml
      .split('\n')
      .filter((line) => gitCheckoutHeadPattern.test(line));
    for (const line of checkoutLines) {
      expect(
        line,
        'workflow must never checkout/switch/worktree from pr-head or ' +
          'pull/N/head: ' +
          line.trim(),
      ).not.toMatch(/(?:pr-head|pull\/\d+\/head)/);
    }

    // Also catch checkout/switch against a 40-char hex SHA that is NOT the
    // trusted base. The workflow fetches the PR head SHA into the pr-head ref
    // and computes merge-base — any git checkout/switch against a raw SHA
    // (other than the already-checked-out trusted base) is suspicious.
    const shaCheckoutPattern =
      /git\s+(?:checkout|switch)\b.*\$\{[^}]*(?:HEAD_SHA|head_sha)[^}]*\}/;
    expect(
      yml,
      'workflow must never checkout/switch to the PR head SHA',
    ).not.toMatch(shaCheckoutPattern);
  });

  it('actions/checkout always uses the trusted base ref, never the PR head', () => {
    const { yml } = loadWorkflow();
    // The checkout step must use the trusted base, never the PR head SHA.
    const checkoutHeadShaPattern =
      /ref:\s+\$\{\{[^}]*pr-context\.outputs\.head_sha[^}]*\}\}/;
    expect(
      yml,
      'actions/checkout must never use the PR head SHA as ref',
    ).not.toMatch(checkoutHeadShaPattern);

    // Any actions/checkout with a ref: must use the trusted base SHA.
    const checkoutSteps = yml.split('uses: actions/checkout@');
    for (let i = 1; i < checkoutSteps.length; i++) {
      const stepBlock = checkoutSteps[i];
      const refMatch = stepBlock.match(/ref:\s+(.+)/);
      if (refMatch) {
        const refValue = refMatch[1].trim();
        expect(
          refValue,
          'actions/checkout ref must be the trusted base SHA, got: ' + refValue,
        ).toBe('${{ steps.pr-context.outputs.trusted_base_sha }}');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Workflow-wiring: every process.env.X in an embedded script must be satisfied
// by the step's own env: block or the workflow-level env: block.
// ---------------------------------------------------------------------------

// Env vars provided by the GitHub Actions runner itself — not by the workflow
// YAML. These are the only keys exempt from the wiring check, and they are
// listed explicitly so a regression can never hide behind a loose allowlist.
const RUNNER_PROVIDED_ENV = new Set(['HOME', 'GITHUB_ENV']);

function collectEnvKeys(source: string): Set<string> {
  const keys = new Set<string>();
  for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
    keys.add(match[1]);
  }
  return keys;
}

function stepLabel(step: WorkflowStep): string {
  return step.name ?? step.id ?? '<unnamed step>';
}

function availableEnvKeys(job: WorkflowJob, step: WorkflowStep): Set<string> {
  const workflowEnv = asOptionalRecord(workflowEnvBlock());
  const jobEnv = asOptionalRecord(job.env);
  const stepEnv = asOptionalRecord(step.env);
  return new Set([
    ...(workflowEnv ? Object.keys(workflowEnv) : []),
    ...(jobEnv ? Object.keys(jobEnv) : []),
    ...(stepEnv ? Object.keys(stepEnv) : []),
  ]);
}

function workflowEnvBlock(): Record<string, unknown> | undefined {
  const { parsed } = loadWorkflow();
  return asOptionalRecord(parsed['env']);
}

function assertEnvWiring(stepName: string): void {
  const job = getCodeReviewJob();
  const step = stepNamed(job, stepName);
  const script = commandText(step);
  const required = collectEnvKeys(script);
  const available = availableEnvKeys(job, step);
  const missing = [...required].filter(
    (key) => !available.has(key) && !RUNNER_PROVIDED_ENV.has(key),
  );
  expect(
    missing,
    `Step "${stepName}" reads process.env.${missing[0] ?? '<key>'} but ` +
      'it is not defined in the step env: block or the workflow-level env: ' +
      'block. Add the missing env entry or the workflow will silently pass ' +
      'undefined to the embedded script driver.',
  ).toEqual([]);
}

describe('workflow-wiring — embedded script env vars are satisfied by env blocks', () => {
  it('Build OCR canary metrics step satisfies every process.env.X it reads', () => {
    assertEnvWiring('Build OCR canary metrics');
  });

  it('Resolve effective review context step satisfies every process.env.X it reads', () => {
    assertEnvWiring('Resolve effective review context');
  });
});

// ---------------------------------------------------------------------------
// Boundary test: sites BEFORE the review-context step keep direct sources
// ---------------------------------------------------------------------------

describe('review-context boundary — pre-step sites keep direct pr-context/resolve-range sources', () => {
  it('Checkout trusted base uses pr-context.outputs.trusted_base_sha', () => {
    const { yml } = loadWorkflow();
    expect(yml).toContain(
      'ref: ${{ steps.pr-context.outputs.trusted_base_sha }}',
    );
  });

  it('Fetch PR head step uses pr-context.outputs.number and trusted_base_sha', () => {
    const { yml } = loadWorkflow();
    // The fetch step is before the review-context step, so it must use
    // direct pr-context sources (OCR_EFFECTIVE_* do not exist yet).
    const fetchStepStart = yml.indexOf(
      '- name: Fetch PR head and compute merge-base',
    );
    const fetchStepEnd = yml.indexOf(
      '- name: Read OCR checkpoint',
      fetchStepStart,
    );
    expect(fetchStepStart).toBeGreaterThanOrEqual(0);
    expect(fetchStepEnd).toBeGreaterThan(fetchStepStart);
    const fetchStep = yml.slice(fetchStepStart, fetchStepEnd);
    expect(fetchStep).toContain(
      'PR_NUMBER: ${{ steps.pr-context.outputs.number }}',
    );
    expect(fetchStep).toContain(
      'TRUSTED_BASE_SHA: ${{ steps.pr-context.outputs.trusted_base_sha }}',
    );
  });

  it('Resolve review range step uses pr-context.outputs.trusted_base_sha', () => {
    const { yml } = loadWorkflow();
    const resolveStart = yml.indexOf('- name: Resolve review range');
    const resolveEnd = yml.indexOf(
      '- name: Resolve effective review context',
      resolveStart,
    );
    expect(resolveStart).toBeGreaterThanOrEqual(0);
    expect(resolveEnd).toBeGreaterThan(resolveStart);
    const resolveStep = yml.slice(resolveStart, resolveEnd);
    expect(resolveStep).toContain(
      'API_BASE_SHA: ${{ steps.pr-context.outputs.trusted_base_sha }}',
    );
  });
});
