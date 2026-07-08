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
  commonCredentialInput,
  expectCommonCredentialsRedacted,
  expectContainsAll,
  extractFunctionSource,
  hasPerl,
  makePostSanitizer,
  normalize,
  readRootFile,
  runNotifySanitizer,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

describe('.github/workflows/ocr-review.yml', () => {
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
    expect(
      workflowYml.trim(),
      `${WORKFLOW_PATH} should have content`,
    ).toBeTruthy();
    try {
      workflow = yaml.load(workflowYml);
    } catch (error) {
      throw new Error(`Failed to parse ${WORKFLOW_PATH}: ${error.message}`, {
        cause: error,
      });
    }
    expect(
      workflow && typeof workflow === 'object',
      `${WORKFLOW_PATH} should parse to a YAML mapping`,
    ).toBeTruthy();
    codeReviewJob = workflow.jobs?.['code-review'];
    expect(
      codeReviewJob,
      'workflow should contain job: code-review',
    ).toBeTruthy();
    notifyJob = workflow.jobs?.['notify-ocr-infrastructure-failure'];
    expect(
      notifyJob,
      'workflow should contain job: notify-ocr-infrastructure-failure',
    ).toBeTruthy();
    postStep = stepNamed(codeReviewJob, 'Post OCR results');
    postScript = commandText(postStep);
    notifyStep = stepNamed(
      notifyJob,
      'Notify OCR infrastructure failure issue',
    );
    notifyRun = commandText(notifyStep);
  });

  it('is discovered by the scripts Vitest configuration used in CI', () => {
    const vitestConfig = readRootFile('scripts/tests/vitest.config.ts');

    expect(vitestConfig).toContain(
      "include: ['scripts/tests/**/*.test.{js,ts}']",
    );
  });

  it('uses job-level concurrency so skipped issue comments cannot cancel OCR', () => {
    const group = codeReviewJob.concurrency?.group;
    const normalizedGroup = normalize(group);
    const normalizedJobIf = normalize(codeReviewJob.if);

    expect(workflow.concurrency).toBeUndefined();
    expect(codeReviewJob['timeout-minutes']).toBe(45);
    expect(codeReviewJob.outputs?.infrastructure_failure).toBe(
      '${{ steps.ocr-classification.outputs.infrastructure_failure }}',
    );
    expect(codeReviewJob.outputs?.policy_failure).toBe(
      '${{ steps.ocr-classification.outputs.policy_failure }}',
    );
    expect(codeReviewJob.concurrency?.['cancel-in-progress']).toBe(true);
    expect(normalizedGroup).toContain(normalize('${{ github.workflow }}'));
    expect(group).toContain(
      'github.event.pull_request.number || github.event.issue.number || inputs.pr_number',
    );
    expect(group).not.toContain('ocr-review-');
    expect(group).not.toContain("github.event_name == 'issue_comment'");
    expect(group).not.toContain("'command'");
    expect(group).not.toContain("'automatic'");
    expect(group).not.toContain('github.event.action');
    expect(group).not.toContain('github.event.comment.author_association');
    expect(group).not.toContain('github.event.comment.body');
    expect(group).not.toContain(
      "format('comment-{0}', github.event.comment.id)",
    );
    expect(normalizedJobIf).toContain(
      normalize("github.event_name == 'issue_comment'"),
    );
    expect(normalizedGroup).not.toContain(
      normalize('github.event.comment.author_association'),
    );
    expect(workflowYml).toContain(
      'Job-level concurrency is evaluated only for runs that pass this job if filter',
    );
    expect(workflowYml).toContain(
      'All authorized OCR triggers for the same PR share one workflow-scoped group',
    );
    expect(workflowYml).toContain(
      'run owns the sticky summary and inline-comment posting',
    );
  });

  it('keeps the job filter responsible for authorized command issue comments', () => {
    const normalizedJobIf = normalize(codeReviewJob.if);
    const issueCommentFragments = [
      "github.event_name == 'issue_comment'",
      'github.event.issue.pull_request != null',
      "github.event.comment.author_association == 'OWNER'",
      "github.event.comment.author_association == 'MEMBER'",
      "github.event.comment.author_association == 'COLLABORATOR'",
      "github.event.comment.body == '/ocr'",
      "startsWith(github.event.comment.body, '/ocr ')",
      "startsWith(toJSON(github.event.comment.body), '\"/ocr\\n')",
      "startsWith(toJSON(github.event.comment.body), '\"/ocr\\r\\n')",
      "startsWith(toJSON(github.event.comment.body), '\"/ocr\\t')",
      "github.event.comment.body == '/open-code-review'",
      "startsWith(github.event.comment.body, '/open-code-review ')",
      "startsWith(toJSON(github.event.comment.body), '\"/open-code-review\\n')",
      "startsWith(toJSON(github.event.comment.body), '\"/open-code-review\\r\\n')",
      "startsWith(toJSON(github.event.comment.body), '\"/open-code-review\\t')",
    ];

    for (const fragment of issueCommentFragments) {
      expect(normalizedJobIf).toContain(normalize(fragment));
    }
    expect(workflowYml).not.toContain(
      'Keep this predicate in sync with the code-review job if filter',
    );
    expect(workflowYml).not.toContain(
      'concurrency is evaluated before the job-level if filter',
    );
  });

  it('extracts function sources with braces in strings, templates, comments, and regexes', () => {
    const source = [
      'function target() {',
      '  const stringValue = "}";',
      '  const templateValue = `prefix ${valueWithBrace({ nested: `inner } ${other}` })} suffix`;',
      '  const regexValue = /[{}]\\/}/gi;',
      '  const ratio = total / count;',
      '  const parenthesizedRatio = (total + extra) / count;',
      '  const returnedRegex = () => /done[}]/gi;',
      '  if (shouldReturnRegex) return /returned[}]/gi;',
      '  const typedRegex = typeof /typed[}]/gi;',
      '  const returnedDivision = () => total / count;',
      '  // }',
      '  /* { */',
      '  return { ok: true };',
      '}',
      'function other() {',
      '  return false;',
      '}',
    ].join('\n');

    const extracted = extractFunctionSource(source, 'target');

    expect(extracted).toContain('return { ok: true };');
    expect(extracted).toContain(
      'const parenthesizedRatio = (total + extra) / count;',
    );
    expect(extracted).toContain('const ratio = total / count;');
    expect(extracted).toContain('const returnedRegex = () => /done[}]/gi;');
    expect(extracted).toContain(
      'if (shouldReturnRegex) return /returned[}]/gi;',
    );
    expect(extracted).toContain('const typedRegex = typeof /typed[}]/gi;');
    expect(extracted).toContain(
      'const returnedDivision = () => total / count;',
    );
    expect(extracted).toContain('// }');
    expect(extracted).not.toContain('function other');
  });

  it('sets deterministic, non-updating OCR environment defaults', () => {
    expect(workflow.env?.OCR_NO_UPDATE).toBe('1');
    expect(workflow.env?.NO_COLOR).toBe('1');
  });

  it('documents that OCR auto-update is disabled for deterministic runs', () => {
    expect(workflowYml).toContain(
      '# Keep CI reviews deterministic by disabling OCR self-update checks.',
    );
  });

  it('extracts functions with trailing line comments without silently truncating', () => {
    const source = [
      'function target() {',
      '  return true;',
      '} // trailing comment without newline',
    ].join('\n');

    const extracted = extractFunctionSource(source, 'target');

    expect(extracted).toBe('function target() {\n  return true;\n}');
  });

  it('uses explicit bash shells for workflow run scripts', () => {
    const runSteps = codeReviewJob.steps.filter((step) => step.run);
    for (const step of runSteps) {
      expect(step.shell, `${step.name} should use bash`).toBe('bash');
    }
    expect(notifyStep.shell).toBe('bash');
  });

  it('installs OpenCodeReview under RUNNER_TEMP and verifies the command', () => {
    const installRun = commandText(
      stepNamed(codeReviewJob, 'Install OpenCodeReview'),
    );

    expectContainsAll(installRun, [
      'OCR_PREFIX="${RUNNER_TEMP}/ocr-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"',
      'npm install --prefix "$OCR_PREFIX" --ignore-scripts @alibaba-group/open-code-review@1.6.1',
      'echo "70" > ocr-exit-code.txt',
      'OCR_BIN="${OCR_PREFIX}/node_modules/.bin"',
      'echo "$OCR_BIN" >> "$GITHUB_PATH"',
      'export PATH="${OCR_BIN}:${PATH}"',
      'command -v ocr',
      'ocr version > ocr-version.txt',
    ]);
    expect(installRun).not.toContain('${OCR_PREFIX}/bin');
    expect(installRun).not.toContain('npm install -g');
  });

  it('records OCR phases and keeps provider/runtime failures non-blocking', () => {
    const installRun = commandText(
      stepNamed(codeReviewJob, 'Install OpenCodeReview'),
    );
    const validateRun = commandText(
      stepNamed(codeReviewJob, 'Validate OCR configuration'),
    );
    const preflightRun = commandText(
      stepNamed(codeReviewJob, 'Validate OCR LLM connectivity'),
    );
    const previewRun = commandText(
      stepNamed(codeReviewJob, 'Verify review scope includes changed tests'),
    );
    const reviewRun = commandText(
      stepNamed(codeReviewJob, 'Run OpenCodeReview'),
    );

    expect(
      workflowYml.match(/mark_infrastructure_failure\(\)/g) ?? [],
    ).toHaveLength(1);
    for (const run of [
      installRun,
      validateRun,
      preflightRun,
      previewRun,
      reviewRun,
    ]) {
      expect(run).toContain('. ./ocr-workflow-helpers.sh');
    }

    expectContainsAll(installRun, [
      'mark_infrastructure_failure "install" "OpenCodeReview installation failed"',
      'mark_infrastructure_failure "install" "OpenCodeReview command was not found after install"',
      'mark_infrastructure_failure "install" "OpenCodeReview version check failed"',
    ]);
    expectContainsAll(validateRun, [
      'if [ -s ocr-exit-code.txt ]; then',
      'Skipping OCR configuration validation because an earlier OCR setup failure was recorded.',
      'echo "validate" > ocr-phase.txt',
      'echo "::warning::Required variable OCR_LLM_URL is not set"',
      'echo "78" > ocr-exit-code.txt',
      'mark_infrastructure_failure "validate" "OCR configuration is missing required variables or secrets"',
      'exit 0',
    ]);
    expectContainsAll(preflightRun, [
      'if [ -s ocr-exit-code.txt ]; then',
      'Skipping OCR LLM connectivity check because an earlier OCR setup/configuration failure was recorded.',
      'echo "llm-preflight" > ocr-phase.txt',
      'timeout 120s ocr llm test >> ocr-stderr.log 2>&1',
      'if [ "$preflight_status" -eq 124 ]; then',
      'mark_infrastructure_failure "llm-preflight" "OCR LLM connectivity check timed out"',
      'mark_infrastructure_failure "llm-preflight" "OCR LLM connectivity check failed"',
      'echo "$preflight_status" > ocr-exit-code.txt',
    ]);
    expectContainsAll(previewRun, [
      'if [ -s ocr-exit-code.txt ]; then',
      'Skipping OCR preview because an earlier OCR setup/configuration failure was recorded.',
      'echo "preview" > ocr-phase.txt',
      'command -v ocr',
      'ocr review --preview --from "$BASE_SHA" --to "$HEAD_SHA"',
      'echo "::warning::Could not verify OCR preview scope for changed test files."',
      'echo "$status" > ocr-exit-code.txt',
      'mark_infrastructure_failure "preview" "OCR preview command failed"',
      'Could not normalize OCR preview output.',
      'mark_infrastructure_failure "preview" "OCR preview normalization failed"',
      'exit 0',
    ]);
    expectContainsAll(reviewRun, [
      'if [ -s ocr-exit-code.txt ]; then',
      'Skipping OCR review because an earlier OCR setup/configuration/preview failure was recorded.',
      'echo "review" > ocr-phase.txt',
      'command -v ocr',
      'if ! cp ocr-stdout.raw ocr-result.json; then',
      ': > ocr-result.json',
      'echo "$status" > ocr-exit-code.txt',
      'if grep -Eqi "all [0-9]+ file review(\\(s\\)|s)? failed" ocr-stderr.log; then',
      'mark_infrastructure_failure "review" "all OCR per-file reviews failed; likely LLM provider/config/auth failure"',
      'else',
      'mark_infrastructure_failure "review" "OCR review command failed"',
      'exit 0',
    ]);
  });

  it('keeps changed tests in scope while ignoring deleted tests', () => {
    const workflowText = normalize(workflowYml);
    expectContainsAll(workflowText, [
      '"**/*.test.{js,jsx,mjs,cjs,ts,tsx}"',
      '"**/*.spec.{js,jsx,mjs,cjs,ts,tsx}"',
      '"**/__tests__/**"',
      '"**/tests/**"',
      '"**/test/**"',
      'git diff --name-only --diff-filter=d "${BASE_SHA}..${HEAD_SHA}"',
    ]);
  });

  it('posts sanitized OCR diagnostics after failures without failing the check', () => {
    expect(postStep.if).toBe('always()');
    expect(postStep.env?.OCR_LLM_TOKEN).toBe(
      '${{ secrets.OCR_LLM_AUTH_TOKEN }}',
    );
    expect(postStep.env?.OCR_LLM_URL).toBe('${{ vars.OCR_LLM_URL }}');
    expectContainsAll(postScript, [
      'Run: ${runUrl}',
      'Phase: \\`${diagnosticPhase}\\`',
      'Exit code: \\`${exitCode}\\`',
      'OCR stderr excerpt',
      'ocr-stderr.log',
      'OCR preview stderr excerpt',
      'ocr-preview-stderr.log',
      'if (!ran || infrastructureFailure) {',
      'Artifacts: `ocr-review-output`',
      'if (policyFailure) {',
      'core.setFailed(`OCR policy failure: ${policyFailure}`);',
      'core.warning(`OpenCodeReview failed or produced unparsable output (exit code ${exitCode}).`)',
    ]);
    expectContainsAll(postScript, [
      'const exactSecrets = [ocrTokenForRedaction, ocrUrlForRedaction]',
      'delete process.env.OCR_LLM_TOKEN;',
      'delete process.env.OCR_LLM_URL;',
      'function redactSecretDiagnostics(value) {',
      "'[REDACTED]'",
      'Authorization\\s*:\\s*(?:(?:Bearer|Basic|token|ApiKey)\\s+)?',
      'x-api-key\\s*:\\s*',
      'api[_-]?key\\s*[=:]\\s*',
      '[?&](?:key|api[_-]?key|token)=',
      'access[_-]?token\\s*[=:]\\s*',
      'refresh[_-]?token\\s*[=:]\\s*',
      'id[_-]?token\\s*[=:]\\s*',
      'token\\s*[=:]\\s*',
      'secret\\s*[=:]\\s*',
      '[A-Za-z0-9_./+=:@-]{16,}',
      "sanitizeExcerpt(readTrimmed(fileName, ''))",
      'try {',
      'github.rest.issues.updateComment({',
      'github.rest.issues.createComment({',
      'github.rest.issues.deleteComment({',
      'Failed to post OCR sticky summary; continuing without failing the workflow',
    ]);
    expect(
      postScript.indexOf("sanitizeExcerpt(readTrimmed(fileName, ''))"),
    ).toBeGreaterThan(
      postScript.indexOf('function stderrSection(title, fileName) {'),
    );
    expect(postScript).not.toContain('core.setFailed(`OpenCodeReview failed');
    expect(
      postScript.indexOf('core.setFailed(`OCR policy failure:'),
    ).toBeLessThan(
      postScript.indexOf(
        'core.warning(`OpenCodeReview failed or produced unparsable output',
      ),
    );
  });

  it('redacts exact OCR secrets with regex metacharacters and backslashes in PR diagnostics', () => {
    const secret = String.raw`tok$^.*+?()[]{}|\slash\end`;
    const sanitize = makePostSanitizer(postScript, secret);

    const sanitized = sanitize(`first ${secret} second ${secret}`);

    expect(sanitized).toBe('first [REDACTED] second [REDACTED]');
    expect(sanitized).not.toContain(secret);
  });

  it('redacts common credential patterns in PR diagnostics', () => {
    const sanitize = makePostSanitizer(postScript, 'unused-secret');
    const diagnostic = [
      'Error: OCR preview failed for packages/core/src/retry.ts:42',
      'snippet: if (attempt < maxAttempts) return retry(error);',
    ].join('\n');

    const sanitized = sanitize(
      [commonCredentialInput(), diagnostic].join('\n'),
    );

    expectCommonCredentialsRedacted(sanitized);
    expect(sanitized).toContain(diagnostic);
  });

  it('does not redact short generic token and secret diagnostic words in PR diagnostics', () => {
    const sanitize = makePostSanitizer(postScript, 'unused-secret');
    const diagnostic =
      'token=expired secret=enabled while auth_token_value remains visible';

    expect(sanitize(diagnostic)).toBe(diagnostic);
  });

  it('redacts the configured OCR LLM URL from PR diagnostics', () => {
    const url = 'https://llm.example.test/v1/messages?api_key=sk-url-secret';
    const sanitize = makePostSanitizer(postScript, 'unused-secret', url);

    const sanitized = sanitize(`request failed for ${url}`);

    expect(sanitized).toBe('request failed for [REDACTED]');
    expect(sanitized).not.toContain(url);
  });

  it('falls back to literal exact-secret replacement if regex construction fails', () => {
    const secret = 'literal-secret';
    const sanitize = makePostSanitizer(postScript, secret, '', {
      RegExp: () => {
        throw new Error('forced RegExp failure');
      },
    });

    const sanitized = sanitize(`first ${secret} second ${secret}`);

    expect(sanitized).toBe('first [REDACTED] second [REDACTED]');
    expect(sanitized).not.toContain(secret);
  });
  it('redacts exact OCR secrets with regex metacharacters and backslashes in notify diagnostics', () => {
    // Include Perl's \E escape marker to prove quotemeta prevents it from ending literal matching early.
    const secret = String.raw`tok$^.*+?()[]{}|\slash\Eend`;

    const sanitized = runNotifySanitizer(
      notifyRun,
      `first ${secret} second ${secret}`,
      secret,
    );

    expect(sanitized).toBe('first [REDACTED] second [REDACTED]');
    expect(sanitized).not.toContain(secret);
  });

  it('redacts common credential patterns in notify diagnostics', () => {
    const diagnostic = [
      'Error: OCR review failed for packages/agents/src/core/TurnProcessor.ts:266',
      'snippet: for await (const event of stream) handle(event);',
    ].join('\n');

    const sanitized = runNotifySanitizer(
      notifyRun,
      [commonCredentialInput(), diagnostic].join('\n'),
      'unused-secret',
    );

    expectCommonCredentialsRedacted(sanitized);
    expect(sanitized).toContain(diagnostic);
  });

  it('does not redact short generic token and secret diagnostic words in notify diagnostics', () => {
    const diagnostic =
      'token=expired secret=enabled while auth_token_value remains visible';

    expect(runNotifySanitizer(notifyRun, diagnostic, 'unused-secret')).toBe(
      diagnostic,
    );
  });

  it('redacts the configured OCR LLM URL from notify diagnostics', () => {
    const url = 'https://llm.example.test/v1/messages?api_key=sk-url-secret';

    const sanitized = runNotifySanitizer(
      notifyRun,
      `request failed for ${url}`,
      'unused-secret',
      { OCR_LLM_URL: url },
    );

    expect(sanitized).toBe('request failed for [REDACTED]');
    expect(sanitized).not.toContain(url);
  });

  it.skipIf(!hasPerl())(
    'fails closed with process details when notify diagnostic sanitization fails',
    () => {
      const secret = 'must-not-leak';

      expect(() =>
        runNotifySanitizer(notifyRun, `diagnostic ${secret}`, secret, {
          PERL5OPT: '-MNo::Such::Module',
        }),
      ).toThrow(/status: .*\ncode: .*\nsignal: .*\nstderr:/);
    },
  );
  it('sanitizes notify-job OCR diagnostics before issue bodies', () => {
    expect(notifyStep.env?.OCR_LLM_TOKEN).toBe(
      '${{ secrets.OCR_LLM_AUTH_TOKEN }}',
    );
    expect(notifyStep.env?.OCR_LLM_URL).toBe('${{ vars.OCR_LLM_URL }}');
    expect(notifyStep.shell).toBe('bash');
    expectContainsAll(notifyRun, [
      'sanitize_diagnostics() {',
      'local diagnostic',
      'diagnostic="$1"',
      'exact_secret="${OCR_LLM_TOKEN:-}"',
      'exact_url="${OCR_LLM_URL:-}"',
      'OCR_EXACT_SECRET="$exact_secret" OCR_EXACT_URL="$exact_url"',
      '$url = $ENV{"OCR_EXACT_URL"} // "";',
      'REDACTED',
      'quotemeta($secret)',
      'quotemeta($url)',
      'Authorization\\s*:\\s*(?:(?:Bearer|Basic|token|ApiKey)\\s+)?',
      'x-api-key\\s*:\\s*',
      'api[_-]?key\\s*[=:]\\s*',
      '[?&](?:key|api[_-]?key|token)=',
      'access[_-]?token\\s*[=:]\\s*',
      'refresh[_-]?token\\s*[=:]\\s*',
      'id[_-]?token\\s*[=:]\\s*',
      'token\\s*[=:]\\s*',
      'secret\\s*[=:]\\s*',
      '[A-Za-z0-9_.\\/+=:\\@-]{16,}',
      'if ! command -v perl >/dev/null 2>&1; then',
      'sanitize_diagnostics "$infra_failure"',
      'diagnostic_block="$(printf \'%s\\n\' "$sanitized_infra_failure" | sed \'s/^/    /\')"',
    ]);
    expect(notifyRun).toContain(
      'if ! sanitized_infra_failure="$(sanitize_diagnostics "$infra_failure")"; then',
    );
    expect(notifyRun).not.toContain(
      'Infrastructure diagnostic: ${infra_failure}.',
    );
  });

  it('marks changed-test scope guard failures as policy failures with exit-code artifacts', () => {
    const initializeRun = commandText(
      stepNamed(codeReviewJob, 'Initialize OCR artifact files'),
    );
    const previewRun = commandText(
      stepNamed(codeReviewJob, 'Verify review scope includes changed tests'),
    );

    expectContainsAll(initializeRun, [
      'set -euo pipefail',
      ': > ocr-policy-failure.txt',
      ': > ocr-infrastructure-failure.txt',
      'mark_policy_failure() {',
      'echo "$1" > ocr-policy-failure.txt',
    ]);
    expectContainsAll(previewRun, [
      'echo "changed-test-missing" > ocr-phase.txt',
      'echo "1" > ocr-exit-code.txt',
      'mark_policy_failure "changed test files were missing from OCR reviewed set"',
      'echo "changed-test-excluded" > ocr-phase.txt',
      'mark_policy_failure "changed test files were excluded from OCR reviewed set"',
      'exit 1',
    ]);
    expect(
      previewRun.match(/mark_policy_failure "changed test files/g) ?? [],
    ).toHaveLength(2);
  });

  it('records parse/unusable OCR output as infrastructure only after zero-exit OCR', () => {
    expectContainsAll(postScript, [
      "const INFRA_FAILURE_FILE = 'ocr-infrastructure-failure.txt';",
      "const POLICY_FAILURE_FILE = 'ocr-policy-failure.txt';",
      "markInfrastructureFailure('parse', 'OCR output was empty or unusable')",
      "markInfrastructureFailure('parse', `OCR output could not be parsed: ${parseErr.message || parseErr}`)",
      "markInfrastructureFailure('parse', 'OCR output did not contain a supported findings array')",
      'if (policyFailure) {',
      'Skipping OCR output parsing because OCR policy failure was recorded.',
      'if (exitCode === 0) {',
      "const raw = fs.readFileSync('ocr-result.json', 'utf8');",
      'Skipping OCR output parsing because phase',
      'fs.writeFileSync(INFRA_FAILURE_FILE,',
    ]);
    expect(postScript).toContain("readTrimmed(POLICY_FAILURE_FILE, '')");
    expect(postScript).toContain("readExitCode('ocr-exit-code.txt')");
    expect(postScript).not.toContain(
      'diagnosticPhase = `${phase}/post-results`',
    );
    expect(postScript).not.toContain('/post-results');
    expect(postScript).not.toContain(
      "Number(fs.readFileSync('ocr-exit-code.txt', 'utf8').trim())",
    );

    const policyIndex = postScript.indexOf(
      "const policyFailure = readTrimmed(POLICY_FAILURE_FILE, '');",
    );
    const parseIndex = postScript.indexOf(
      "const raw = fs.readFileSync('ocr-result.json', 'utf8');",
    );
    const skipIndex = postScript.indexOf(
      'Skipping OCR output parsing because phase',
    );
    expect(policyIndex).toBeGreaterThan(-1);
    expect(parseIndex).toBeGreaterThan(policyIndex);
    expect(skipIndex).toBeGreaterThan(parseIndex);

    const uploadIndex = codeReviewJob.steps.findIndex(
      (step) => step.name === 'Upload OCR artifacts',
    );
    const postIndex = codeReviewJob.steps.findIndex(
      (step) => step.name === 'Post OCR results',
    );
    const classificationIndex = codeReviewJob.steps.findIndex(
      (step) => step.name === 'Resolve OCR failure classification',
    );
    expect(postIndex).toBeGreaterThan(-1);
    expect(classificationIndex).toBeGreaterThan(postIndex);
    expect(uploadIndex).toBeGreaterThan(classificationIndex);
  });

  it('inserts infrastructure diagnostics semantically after the artifact line', () => {
    expect(postScript).toContain('const artifactLine =');
    expect(postScript).toContain(
      'const artifactLineIndex = body.indexOf(`- ${artifactLine}`);',
    );
    expect(postScript).toContain(
      'body.splice(artifactLineIndex + 1, 0, infrastructureDiagnosticLine);',
    );
    expect(postScript).not.toContain('body.splice(12, 0');
  });

  it('surfaces zero-exit parse failures in PR and infrastructure diagnostics', () => {
    expectContainsAll(postScript, [
      'diagnosticPhase = markerPhase;',
      "fs.writeFileSync('ocr-phase.txt', `${markerPhase}\\n`);",
      "const infrastructureFailure = readTrimmed(INFRA_FAILURE_FILE, '');",
      'const sanitizedInfrastructureFailure = redactSecretDiagnostics(infrastructureFailure);',
      '`- Infrastructure diagnostic: \\`${sanitizedInfrastructureFailure.replace(/`/g, "\\\\`")}\\``',
    ]);
    expect(postScript).toContain('Phase: \\`${diagnosticPhase}\\`');
    expect(notifyRun).toContain('phase="$(cat ocr-phase.txt)"');
  });

  it('preserves native failure phase in diagnostics', () => {
    expect(postScript).toContain('let diagnosticPhase = phase;');
    expect(postScript).toContain('Phase: \\`${diagnosticPhase}\\`');
    expect(postScript).not.toContain('/post-results');
    expect(postScript).not.toContain(
      'diagnosticPhase = `${phase}/post-results`',
    );
  });

  it('uploads artifacts without noisy missing-file failures', () => {
    const uploadStep = stepNamed(codeReviewJob, 'Upload OCR artifacts');
    expect(uploadStep.if).toBe('always()');
    expect(uploadStep.with?.path).toContain('ocr-phase.txt');
    expect(uploadStep.with?.path).toContain('ocr-infrastructure-failure.txt');
    expect(uploadStep.with?.path).toContain('ocr-policy-failure.txt');
    const redactRun = commandText(
      stepNamed(codeReviewJob, 'Redact OCR diagnostic artifacts'),
    );
    for (const artifact of uploadStep.with?.path.trim().split(/\s+/) ?? []) {
      expect(redactRun).toContain(`'${artifact}'`);
    }
    expectContainsAll(redactRun, [
      'replaceWithRedactionFailure',
      'redaction failed for ${fileName}: ${code}',
      'fs.rmSync(fileName, { force: true });',
      'process.exitCode = 1;',
      "if (error && error.code !== 'ENOENT') {",
    ]);
    expect(redactRun).not.toContain('throw error');
    expect(uploadStep.with?.['if-no-files-found']).toBe('warn');
  });

  it('notifies a deduplicated ci/cd issue for OCR infrastructure errors', () => {
    expect(notifyJob?.needs).toBe('code-review');
    expect(notifyJob?.['timeout-minutes']).toBe(5);
    expect(notifyJob?.concurrency?.group).toBe(
      'ocr-review-infrastructure-issue',
    );
    expect(notifyJob?.concurrency?.['cancel-in-progress']).toBe(false);
    expect(notifyJob.if).toBe(
      "${{ !cancelled() && (needs.code-review.result == 'success' || needs.code-review.result == 'failure') }}",
    );
    expect(notifyStep.if).toContain('always()');
    expect(notifyStep.env?.GH_TOKEN).toBe('${{ github.token }}');
    expect(notifyStep.env?.CODE_REVIEW_POLICY_FAILURE).toBe(
      '${{ needs.code-review.outputs.policy_failure }}',
    );
    expect(notifyStep.env?.CODE_REVIEW_INFRASTRUCTURE_FAILURE).toBe(
      '${{ needs.code-review.outputs.infrastructure_failure }}',
    );
    expect(notifyStep.env?.GH_REPO).toBe('${{ github.repository }}');
    expect(notifyStep.env?.RUN_URL).toBe(
      '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
    );
    expect(notifyStep.env?.CODE_REVIEW_RESULT).toBe(
      '${{ needs.code-review.result }}',
    );
    const downloadStep = stepNamed(notifyJob, 'Download OCR artifacts');
    expect(downloadStep.uses).toContain(
      'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
    );
    expect(workflowYml).toContain('ratchet:actions/download-artifact@v4');
    expect(downloadStep['continue-on-error']).toBe(true);
    expectContainsAll(notifyRun, [
      'notify_ocr_infrastructure_failure() {',
      'OCR artifacts were unavailable after code-review completed with failure or infrastructure diagnostics; creating infrastructure notification.',
      'CODE_REVIEW_INFRASTRUCTURE_FAILURE',
      'CODE_REVIEW_POLICY_FAILURE',
      'policy failure recorded by code-review job output',
      'OCR policy failure output was set; skipping missing-artifact infrastructure notification.',
      'OCR artifacts were unavailable; cannot determine whether an infrastructure failure occurred.',
      'cd ocr-review-output || return 1',
      'missing_diagnostics=""',
      'for diagnostic_file in ocr-exit-code.txt ocr-phase.txt ocr-infrastructure-failure.txt ocr-policy-failure.txt; do',
      'phase="artifact"',
      'OCR diagnostic artifact was incomplete: ${missing_diagnostics}',
      'OCR result artifact was missing after a zero-exit review',
      'OCR artifacts were unavailable after code-review completed with failure or infrastructure diagnostics',
      'OCR artifact diagnostics unavailable',
      'exit_code="unknown"',
      'if [ -f ocr-exit-code.txt ] && [ -s ocr-exit-code.txt ]; then',
      'raw_exit_code="$(cat ocr-exit-code.txt)"',
      '\'\'|*[!0-9]*) exit_code="unknown" ;;',
      'if [ -f ocr-phase.txt ] && [ -s ocr-phase.txt ]; then',
      'infra_failure=""',
      'infra_failure="$(cat ocr-infrastructure-failure.txt)"',
      'if [ -n "$policy_failure" ]; then',
      'OCR policy failure detected; skipping infrastructure issue notification.',
      'if [ -z "$infra_failure" ]; then',
      'return 0',
      'command -v gh >/dev/null 2>&1',
      'gh auth status >/dev/null 2>&1',
      'Keep ISSUE_TITLE as a simple repository-owned literal',
      'ISSUE_TITLE="OCR review infrastructure failure"',
      'Artifact: ocr-review-output.',
      'diagnostic_block="$(printf \'%s\\n\' "$sanitized_infra_failure" | sed \'s/^/    /\')"',
      'Raw stderr remains available only in the workflow artifact.',
      'gh issue list',
      '--search "' +
        String.raw`\"` +
        '${ISSUE_TITLE}' +
        String.raw`\"` +
        ' in:title is:issue state:open sort:created-desc"',
      '--label "ci/cd"',
      'if ! body_file="$(mktemp)"; then',
      'Failed to create OCR infrastructure issue body file.',
      'trap \'rm -f "$body_file"\' EXIT',
      'if ! printf \'%s\\n\' "$body" > "$body_file"; then',
      'Failed to write OCR infrastructure issue body file.',
      'rm -f "$body_file"',
      'gh issue comment "${EXISTING_ISSUE}" --body-file "$body_file"',
      'notify_ocr_infrastructure_failure || echo "::warning::OCR infrastructure issue notification failed; continuing."',
      'exit 0',
      'Failed to recheck for existing OCR infrastructure issue before create.',
      'Failed to comment on OCR infrastructure issue after recheck.',
    ]);
    expect(notifyRun).not.toContain('trap \'rm -f "$body_file"\' EXIT RETURN');
    expect(notifyRun).toContain(
      'policy_failure="$(cat ocr-policy-failure.txt)"',
    );
    expect(notifyRun).not.toContain(
      'if [ -z "$infra_failure" ] && { [ -z "$exit_code" ] || [ "$exit_code" = "0" ]; }; then',
    );
    expect(notifyRun).not.toContain('--label "bug"');
  });

  it('uses UTC dates, backoff retries, and label fallback for infrastructure issues', () => {
    const normalizedNotifyRun = normalize(notifyRun);

    expectContainsAll(notifyRun, [
      'sleep $(( attempt * 5 ))',
      "$(TZ=UTC date +'%Y-%m-%d')",
      'create_infrastructure_issue() {',
      'local issue_body_file',
      'issue_body_file="$1"',
      'shift',
      'retry_gh gh issue create "$@" --body-file "$issue_body_file" --label "ci/cd"',
      'Failed to create OCR infrastructure issue with ci/cd label; retrying without labels.',
      'retry_gh gh issue create "$@" --body-file "$issue_body_file"',
      'Failed to create OCR infrastructure issue.',
      'return 1',
      'create_infrastructure_issue "$body_file"',
    ]);
    expect(normalizedNotifyRun).not.toContain('sleep 5');
    expect(normalizedNotifyRun).not.toContain("$(date +'%Y-%m-%d')");
    expect(normalizedNotifyRun).not.toContain('gh label create');
  });

  it('preserves inline review comments and duplicate suppression', () => {
    expectContainsAll(postScript, [
      'github.rest.pulls.createReview({',
      "event: 'COMMENT'",
      'github.rest.pulls.createReviewComment({',
      'existingInlineCommentKeys',
      'Skipping duplicate OCR inline comment',
      'INLINE_MARKER',
    ]);
  });
});
