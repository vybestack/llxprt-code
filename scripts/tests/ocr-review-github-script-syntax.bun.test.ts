/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `actions/github-script` compiles a step's whole `script:` input into an
 * AsyncFunction before executing any of it, so a single stray character
 * anywhere in the block kills the step at parse time — no matter which branch
 * of the script would actually have run. That is silent in review: the YAML is
 * still valid, every other job stays green, and the breakage only surfaces on
 * the first pull request whose OCR run reaches the step.
 *
 * These tests compile every `github-script` block in the OCR review workflow
 * the same way the action does, so a malformed template literal fails here
 * instead of in CI.
 */

import { describe, expect, it } from 'bun:test';
import { readRootFile, WORKFLOW_PATH } from './ocr-review-workflow-helpers.ts';
import {
  jobSteps,
  parseWorkflowYaml,
  type WorkflowStep,
} from './typed-test-helpers.ts';

const GITHUB_SCRIPT_ACTION = 'actions/github-script@';

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  body: string,
) => unknown;

interface GithubScriptBlock {
  readonly job: string;
  readonly step: string;
  readonly source: string;
}

function stepScript(step: WorkflowStep): string | undefined {
  const uses = typeof step.uses === 'string' ? step.uses : '';
  if (!uses.startsWith(GITHUB_SCRIPT_ACTION)) return undefined;
  const script = step.with?.['script'];
  return typeof script === 'string' ? script : undefined;
}

function collectGithubScriptBlocks(): GithubScriptBlock[] {
  const workflow = parseWorkflowYaml(readRootFile(WORKFLOW_PATH));
  const blocks: GithubScriptBlock[] = [];
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    for (const [index, step] of jobSteps(job).entries()) {
      const source = stepScript(step);
      if (source === undefined) continue;
      blocks.push({
        job: jobName,
        step: step.name ?? step.id ?? `step #${index}`,
        source,
      });
    }
  }
  return blocks;
}

describe(`${WORKFLOW_PATH} — github-script blocks compile`, () => {
  const blocks = collectGithubScriptBlocks();

  it('finds the github-script steps it is meant to guard', () => {
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((block) => block.step === 'Post OCR results')).toBe(
      true,
    );
  });

  for (const block of blocks) {
    it(`compiles ${block.job} / ${block.step}`, () => {
      // Compiling — not running — mirrors what actions/github-script does
      // before it invokes the script, and executes none of the workflow logic.
      expect(() => new AsyncFunction(block.source)).not.toThrow();
    });
  }
});
