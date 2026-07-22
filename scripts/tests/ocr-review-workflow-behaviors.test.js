/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  WORKFLOW_PATH,
  commandText,
  expectContainsAll,
  extractFunctionSource,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

describe('.github/workflows/ocr-review.yml — issue #2576 hardening behaviors', () => {
  let workflowYml;
  let workflow;
  let codeReviewJob;
  let postStep;
  let postScript;
  let notifyJob;
  let notifyStep;
  let notifyRun;

  beforeAll(() => {
    workflowYml = readRootFile(WORKFLOW_PATH);
    try {
      workflow = yaml.load(workflowYml);
    } catch (error) {
      throw new Error(`Failed to parse ${WORKFLOW_PATH}: ${error.message}`, {
        cause: error,
      });
    }
    codeReviewJob = workflow.jobs?.['code-review'];
    notifyJob = workflow.jobs?.['notify-ocr-infrastructure-failure'];
    postStep = stepNamed(codeReviewJob, 'Post OCR results');
    postScript = commandText(postStep);
    notifyStep = stepNamed(
      notifyJob,
      'Notify OCR infrastructure failure issue',
    );
    notifyRun = commandText(notifyStep);
  });

  it('exposes a single OCR_VERSION env var set to 1.7.9 (Behavior 1)', () => {
    expect(workflow.env?.OCR_VERSION).toBe('1.7.9');
  });

  it('installs OpenCodeReview using the OCR_VERSION env var (Behavior 1)', () => {
    const installRun = commandText(
      stepNamed(codeReviewJob, 'Install OpenCodeReview'),
    );
    expect(installRun).toContain(
      '"@alibaba-group/open-code-review@${OCR_VERSION}"',
    );
    expect(installRun).not.toContain('1.6.1');
    expect(installRun).not.toContain('@alibaba-group/open-code-review@1.7.9');
  });

  it('exposes a configurable OCR_CONCURRENCY env var set to 2 (Behavior 2)', () => {
    expect(workflow.env?.OCR_CONCURRENCY).toBe('2');
  });

  it('passes --concurrency to the ocr review command (Behavior 2)', () => {
    const reviewRun = commandText(
      stepNamed(codeReviewJob, 'Run OpenCodeReview'),
    );
    expect(reviewRun).toContain('--concurrency "$OCR_CONCURRENCY"');
  });

  it('classifies provider failures into distinct categories (Behavior 3)', () => {
    const reviewRun = commandText(
      stepNamed(codeReviewJob, 'Run OpenCodeReview'),
    );
    expectContainsAll(reviewRun, [
      'grep -Eqi "429|rate limit" ocr-stderr.log',
      'OCR review failed: HTTP 429 rate limit',
      'grep -Eqi "529|overloaded" ocr-stderr.log',
      'OCR review failed: HTTP 529 provider overloaded',
      'grep -Eqi "401|403|auth|unauthorized|forbidden|invalid api key|invalid_api_key|api key" ocr-stderr.log',
      'OCR review failed: authentication or configuration error',
      'grep -Eqi "timeout|timed out" ocr-stderr.log',
      'OCR review failed: timeout',
      'all OCR per-file reviews failed; likely LLM provider/config/auth failure',
      'OCR review command failed',
    ]);
    // The ordering assertions verify the first-match-wins priority of the
    // classifier: if branches are reordered, a message matching multiple
    // patterns (e.g. "429" and "timeout") would be classified differently.
    const http429Index = reviewRun.indexOf('HTTP 429 rate limit');
    const http529Index = reviewRun.indexOf('HTTP 529 provider overloaded');
    const authIndex = reviewRun.indexOf(
      'authentication or configuration error',
    );
    const timeoutIndex = reviewRun.indexOf('OCR review failed: timeout');
    const allFileIndex = reviewRun.indexOf('all OCR per-file reviews failed');
    const genericIndex = reviewRun.indexOf('OCR review command failed');
    expect(http429Index).toBeGreaterThan(-1);
    expect(http529Index).toBeGreaterThan(http429Index);
    expect(authIndex).toBeGreaterThan(http529Index);
    expect(timeoutIndex).toBeGreaterThan(authIndex);
    expect(allFileIndex).toBeGreaterThan(timeoutIndex);
    expect(genericIndex).toBeGreaterThan(allFileIndex);
  });

  it('writes a safe placeholder before redacting artifacts (Behavior 4)', () => {
    const redactRun = commandText(
      stepNamed(codeReviewJob, 'Redact OCR diagnostic artifacts'),
    );
    expectContainsAll(redactRun, [
      'fs.writeFileSync(fileName, REDACTED_PENDING)',
      'const tempFile = `${fileName}.redacting`',
      'fs.writeFileSync(tempFile, redactedContent)',
      'fs.renameSync(tempFile, fileName)',
    ]);
    expect(redactRun).toContain('[REDACTED-PENDING]');
    const placeholderIndex = redactRun.indexOf(
      'fs.writeFileSync(fileName, REDACTED_PENDING)',
    );
    const renameIndex = redactRun.indexOf('fs.renameSync(tempFile, fileName)');
    expect(renameIndex).toBeGreaterThan(placeholderIndex);
  });

  it('does not retry non-idempotent gh issue writes (Behavior 5)', () => {
    expectContainsAll(notifyRun, [
      'gh issue create "$@" --body-file "$issue_body_file" --label "ci/cd"',
      'gh issue create "$@" --body-file "$issue_body_file"',
      'gh issue comment "${EXISTING_ISSUE}" --body-file "$body_file"',
    ]);
    const createWithLabelPattern = /retry_gh\s+gh\s+issue\s+create/;
    expect(notifyRun).not.toMatch(createWithLabelPattern);
    const commentRetryPattern = /retry_gh\s+gh\s+issue\s+comment/;
    expect(notifyRun).not.toMatch(commentRetryPattern);
  });

  it('reconciles ambiguous createComment by marker (Behavior 6)', () => {
    expectContainsAll(postScript, [
      'async function createOrUpdateMarkerComment(summary)',
      'async function reconcileMarkerComment()',
      'comment.body && comment.body.includes(MARKER)',
    ]);
    const postFunctionSource = extractFunctionSource(
      postScript,
      'createOrUpdateMarkerComment',
    );
    expectContainsAll(postFunctionSource, [
      'existing = await reconcileMarkerComment()',
      'github.rest.issues.updateComment({',
      'github.rest.issues.createComment({',
      'const reconciled = await reconcileMarkerComment()',
      'if (reconciled)',
    ]);
  });

  it('retries issue creation without labels only for label errors (Behavior 7)', () => {
    expectContainsAll(notifyRun, [
      'create_infrastructure_issue() {',
      'issue_body_file="$1"',
      'gh issue create "$@" --body-file "$issue_body_file" --label "ci/cd" 2>"${create_stderr}"',
      'local create_stderr',
      'if grep -Eqi "label|labels|not found|does not exist" "${create_stderr}"; then',
      'gh issue create "$@" --body-file "$issue_body_file"',
      'Failed to create OCR infrastructure issue.',
    ]);
    expect(notifyRun).not.toContain(
      'Failed to create OCR infrastructure issue with ci/cd label; retrying without labels.',
    );
  });

  it('converges duplicate tracking issues after create (Behavior 8)', () => {
    expectContainsAll(notifyRun, [
      'converge_duplicate_tracking_issues() {',
      'gh issue list',
      'gh issue comment "${KEEP_ISSUE}"',
      'gh issue close "${dup}"',
      'Failed to list duplicate tracking issues for convergence; duplicates may accumulate.',
    ]);
  });

  it('deduplicates exact candidates before posting (Behavior 9)', () => {
    expectContainsAll(postScript, [
      'function deduplicationKey(finding)',
      'deduplicationKey(finding)',
      'const dedupedFindings = deduplicateFindings(findings)',
      'let suppressedDuplicateCount = 0',
      'Suppressed ${suppressedDuplicateCount} exact duplicate finding(s).',
    ]);
  });

  it('records suppression count in the summary comment (Behavior 10)', () => {
    expect(postScript).toContain(
      'Suppressed ${suppressedDuplicateCount} exact duplicate finding(s).',
    );
    const dedupFunctionSource = extractFunctionSource(
      postScript,
      'deduplicateFindings',
    );
    expectContainsAll(dedupFunctionSource, [
      'const seen = new Map()',
      'seen.has(key)',
      'suppressed += 1',
      'seen.set(key, true)',
      'return { deduped, suppressed }',
    ]);
  });
});
