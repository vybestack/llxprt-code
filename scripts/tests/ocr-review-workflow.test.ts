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
  normalize,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';
import {
  asOptionalRecord,
  asOptionalString,
  asRecord,
  asRecordArray,
  asString,
  asVmFunction,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';
import {
  commonCredentialInput,
  expectCommonCredentialsRedacted,
  makePostSanitizer,
} from './ocr-review-workflow-helpers.ts';

const NOTIFIER_WORKFLOW_PATH =
  '.github/workflows/ocr-infrastructure-notifier.yml';

describe('.github/workflows/ocr-review.yml', () => {
  let workflowYml: string;
  let notifierWorkflowYml: string;
  let workflow: Record<string, unknown>;
  let notifierWorkflow: Record<string, unknown>;
  let codeReviewJob: Record<string, unknown> | undefined;
  let mergeabilityGateJob: Record<string, unknown> | undefined;

  let postStep: Record<string, unknown> | undefined;
  let postScript: string;
  let notifyJob: Record<string, unknown> | undefined;
  let notifyStep: Record<string, unknown> | undefined;
  let notifyRun: string;

  beforeAll(() => {
    workflowYml = readRootFile(WORKFLOW_PATH);
    expect(
      workflowYml.trim(),
      `${WORKFLOW_PATH} should have content`,
    ).toBeTruthy();
    notifierWorkflowYml = readRootFile(NOTIFIER_WORKFLOW_PATH);
    try {
      workflow = parseWorkflowYaml(workflowYml);
      notifierWorkflow = asRecord(yaml.load(notifierWorkflowYml));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse OCR workflows: ${message}`, {
        cause: error,
      });
    }
    expect(
      workflow && typeof workflow === 'object',
      `${WORKFLOW_PATH} should parse to a YAML mapping`,
    ).toBeTruthy();
    expect(
      notifierWorkflow && typeof notifierWorkflow === 'object',
      `${NOTIFIER_WORKFLOW_PATH} should parse to a YAML mapping`,
    ).toBeTruthy();
    const jobs = asOptionalRecord(workflow.jobs);
    codeReviewJob = asOptionalRecord(jobs?.['code-review']);
    expect(
      codeReviewJob,
      'workflow should contain job: code-review',
    ).toBeTruthy();
    mergeabilityGateJob = asOptionalRecord(jobs?.['mergeability-gate']);
    expect(
      mergeabilityGateJob,
      'workflow should contain job: mergeability-gate',
    ).toBeTruthy();
    expect(jobs?.['notify-ocr-infrastructure-failure']).toBeUndefined();
    const notifierJobs = asOptionalRecord(notifierWorkflow.jobs);
    notifyJob = asOptionalRecord(
      notifierJobs?.['notify-ocr-infrastructure-failure'],
    );
    expect(
      notifyJob,
      'notifier workflow should contain job: notify-ocr-infrastructure-failure',
    ).toBeTruthy();
    postStep = stepNamed(codeReviewJob ?? {}, 'Post OCR results');
    postScript = commandText(postStep);
    notifyStep = stepNamed(
      notifyJob ?? {},
      'Notify OCR infrastructure failure issue',
    );
    notifyRun = commandText(notifyStep);
  });

  function jobSteps(): Array<Record<string, unknown>> {
    const steps = asRecordArray(codeReviewJob?.steps)?.map(asRecord);
    return steps ?? [];
  }

  function getEnv(
    step: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    return asOptionalRecord(step?.env);
  }

  function getWith(
    step: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    return asOptionalRecord(step?.with);
  }

  it('is discovered by the scripts Vitest configuration used in CI', () => {
    const vitestConfig = readRootFile('scripts/tests/vitest.config.ts');

    expect(vitestConfig).toContain(
      "include: ['scripts/tests/**/*.test.{js,ts}']",
    );
  });

  it('uses authorization-aware workflow concurrency around the complete run', () => {
    const concurrency = asOptionalRecord(workflow.concurrency);
    const group = asOptionalString(concurrency?.group);
    const normalizedGroup = normalize(group);
    const normalizedCodeReviewIf = normalize(
      asOptionalString(codeReviewJob?.if),
    );
    const normalizedGateIf = normalize(
      asOptionalString(mergeabilityGateJob?.if),
    );

    expect(concurrency?.['cancel-in-progress']).toBe(true);
    expect(codeReviewJob?.['timeout-minutes']).toBe(120);
    const outputs = asOptionalRecord(codeReviewJob?.outputs);
    expect(outputs?.infrastructure_failure).toBe(
      '${{ steps.ocr-final-classification.outputs.infrastructure_failure }}',
    );
    expect(outputs?.policy_failure).toBe(
      '${{ steps.ocr-final-classification.outputs.policy_failure }}',
    );
    expect(mergeabilityGateJob?.concurrency).toBeUndefined();
    expect(codeReviewJob?.concurrency).toBeUndefined();
    expect(normalizedGroup).toContain("format('{0}-pr-{1}', github.workflow,");
    expect(normalizedGroup).toContain(
      "format('{0}-run-{1}', github.workflow, github.run_id)",
    );
    expect(normalizedCodeReviewIf).toContain(
      normalize("needs.mergeability-gate.outputs.should-run == 'true'"),
    );
    expect(normalizedGateIf).toContain(
      normalize("github.event_name == 'issue_comment'"),
    );
  });

  it('keeps the job filter responsible for authorized command issue comments', () => {
    // The authorization predicate has moved to the mergeability-gate job;
    // code-review's if only checks the gate's should-run output.
    const normalizedGateIf = normalize(
      asOptionalString(mergeabilityGateJob?.if),
    );
    const normalizedCodeReviewIf = normalize(
      asOptionalString(codeReviewJob?.if),
    );
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
      expect(normalizedGateIf).toContain(normalize(fragment));
    }
    expect(normalizedCodeReviewIf).toContain(
      normalize("needs.mergeability-gate.outputs.should-run == 'true'"),
    );
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
    const env = asOptionalRecord(workflow.env);
    expect(env?.OCR_NO_UPDATE).toBe('1');
    expect(env?.NO_COLOR).toBe('1');
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
    const runSteps = jobSteps().filter((step) => step.run);
    for (const step of runSteps) {
      expect(step.shell, `${step.name} should use bash`).toBe('bash');
    }
    expect(notifyStep?.shell).toBe('bash');
  });

  it('installs OpenCodeReview under RUNNER_TEMP and verifies the command', () => {
    const installRun = commandText(
      stepNamed(codeReviewJob ?? {}, 'Install OpenCodeReview'),
    );

    expectContainsAll(installRun, [
      'OCR_PREFIX="${RUNNER_TEMP}/ocr-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"',
      'npm install --prefix "$OCR_PREFIX" --ignore-scripts "@alibaba-group/open-code-review@${OCR_VERSION}"',
      'echo "70" > ocr-exit-code.txt',
      'OCR_BIN="${OCR_PREFIX}/node_modules/.bin"',
      'echo "$OCR_BIN" >> "$GITHUB_PATH"',
      'export PATH="${OCR_BIN}:${PATH}"',
      'command -v ocr',
      'ocr version > ocr-version.txt',
    ]);
    expect(installRun).not.toContain('${OCR_PREFIX}/bin');
    expect(installRun).not.toContain('npm install -g');
    expect(installRun).not.toContain('@alibaba-group/open-code-review@1.6.1');
    expect(installRun).not.toContain('@alibaba-group/open-code-review@1.7.17');
    expect(installRun).not.toContain('@alibaba-group/open-code-review@latest');
  });

  it('records OCR phases and keeps provider/runtime failures non-blocking', () => {
    const installRun = commandText(
      stepNamed(codeReviewJob ?? {}, 'Install OpenCodeReview'),
    );
    const validateRun = commandText(
      stepNamed(codeReviewJob ?? {}, 'Validate OCR configuration'),
    );
    const preflightRun = commandText(
      stepNamed(codeReviewJob ?? {}, 'Validate OCR LLM connectivity'),
    );
    const previewRun = commandText(
      stepNamed(
        codeReviewJob ?? {},
        'Verify review scope includes changed tests',
      ),
    );
    const reviewRun = commandText(
      stepNamed(codeReviewJob ?? {}, 'Run OpenCodeReview'),
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
      'timeout 120s ocr llm test >> ocr-preflight.txt 2>&1',
      'cat ocr-preflight.txt >> ocr-stderr.log',
      'if [ "$preflight_status" -eq 124 ]; then',
      'mark_infrastructure_failure "llm-preflight" "OCR LLM connectivity check timed out (model=${OCR_LLM_MODEL:-unknown})"',
      'mark_infrastructure_failure "llm-preflight" "OCR LLM connectivity check failed (model=${OCR_LLM_MODEL:-unknown})"',
      'echo "$preflight_status" > ocr-exit-code.txt',
      'echo "model=${OCR_LLM_MODEL:-unknown}"',
      'echo "provider-url=${OCR_LLM_URL:+configured}"',
      '} > ocr-preflight.txt',
    ]);
    expectContainsAll(previewRun, [
      'if [ -s ocr-exit-code.txt ]; then',
      'Skipping OCR preview because an earlier OCR setup/configuration failure was recorded.',
      'echo "preview" > ocr-phase.txt',
      'command -v ocr',
      'ocr review --preview --from "$FROM_SHA" --to "$HEAD_SHA"',
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
      'grep -Eqi "all [0-9]+ file review(\\(s\\)|s)? failed"',
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
      'git diff --name-only --diff-filter=d "${FROM_SHA}..${HEAD_SHA}"',
    ]);
  });

  it('posts sanitized OCR diagnostics after failures without failing the check', () => {
    expect(postStep?.if).toBe('always()');
    const env = getEnv(postStep);
    expect(env?.OCR_LLM_TOKEN).toBe('${{ secrets.OCR_LLM_AUTH_TOKEN }}');
    expect(env?.OCR_LLM_URL).toBe('${{ vars.OCR_LLM_URL }}');
    expectContainsAll(postScript, [
      'Run: ${runUrl}',
      'Phase: \\`${diagnosticPhase}\\`',
      'Exit code: \\`${exitCode}\\`',
      'OCR stderr excerpt',
      'ocr-stderr.log',
      'OCR preflight excerpt',
      'ocr-preflight.txt',
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
    const stderrSectionIndex = postScript.indexOf(
      'function stderrSection(title, fileName) {',
    );
    expect(stderrSectionIndex).toBeGreaterThan(-1);
    expect(
      postScript.indexOf("sanitizeExcerpt(readTrimmed(fileName, ''))"),
    ).toBeGreaterThan(stderrSectionIndex);
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
    const sanitize = asVmFunction(makePostSanitizer(postScript, secret));

    const sanitized = sanitize(`first ${secret} second ${secret}`);

    expect(sanitized).toBe('first [REDACTED] second [REDACTED]');
    expect(sanitized).not.toContain(secret);
  });

  it('redacts common credential patterns in PR diagnostics', () => {
    const sanitize = asVmFunction(
      makePostSanitizer(postScript, 'unused-secret'),
    );
    const diagnostic = [
      'Error: OCR preview failed for packages/core/src/retry.ts:42',
      'snippet: if (attempt < maxAttempts) return retry(error);',
    ].join('\n');

    const sanitized = sanitize(
      [commonCredentialInput(), diagnostic].join('\n'),
    );

    expectCommonCredentialsRedacted(asString(sanitized));
    expect(sanitized).toContain(diagnostic);
  });

  it('does not redact short generic token and secret diagnostic words in PR diagnostics', () => {
    const sanitize = asVmFunction(
      makePostSanitizer(postScript, 'unused-secret'),
    );
    const diagnostic =
      'token=expired secret=enabled while auth_token_value remains visible';

    expect(sanitize(diagnostic)).toBe(diagnostic);
  });

  it('redacts the configured OCR LLM URL from PR diagnostics', () => {
    const url = 'https://llm.example.test/v1/messages?api_key=sk-url-secret';
    const sanitize = asVmFunction(
      makePostSanitizer(postScript, 'unused-secret', url),
    );

    const sanitized = sanitize(`request failed for ${url}`);

    expect(sanitized).toBe('request failed for [REDACTED]');
    expect(sanitized).not.toContain(url);
  });

  it('falls back to literal exact-secret replacement if regex construction fails', () => {
    const secret = 'literal-secret';
    const sanitize = asVmFunction(
      makePostSanitizer(postScript, secret, '', {
        RegExp: () => {
          throw new Error('forced RegExp failure');
        },
      }),
    );

    const sanitized = sanitize(`first ${secret} second ${secret}`);

    expect(sanitized).toBe('first [REDACTED] second [REDACTED]');
    expect(sanitized).not.toContain(secret);
  });

  it('marks changed-test scope guard failures as policy failures with exit-code artifacts', () => {
    const initializeRun = commandText(
      stepNamed(codeReviewJob ?? {}, 'Initialize OCR artifact files'),
    );
    const previewRun = commandText(
      stepNamed(
        codeReviewJob ?? {},
        'Verify review scope includes changed tests',
      ),
    );

    expectContainsAll(initializeRun, [
      'set -euo pipefail',
      ': > ocr-preflight.txt',
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

    const uploadIndex = jobSteps().findIndex(
      (step) => step.name === 'Upload OCR artifacts',
    );
    const postIndex = jobSteps().findIndex(
      (step) => step.name === 'Post OCR results',
    );
    const classificationIndex = jobSteps().findIndex(
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

  it('surfaces zero-exit parse failures in PR and redacted artifact diagnostics', () => {
    expectContainsAll(postScript, [
      'diagnosticPhase = markerPhase;',
      "fs.writeFileSync('ocr-phase.txt', `${markerPhase}\\n`);",
      "const infrastructureFailure = readTrimmed(INFRA_FAILURE_FILE, '');",
      'const sanitizedInfrastructureFailure = redactSecretDiagnostics(infrastructureFailure);',
      '`- Infrastructure diagnostic: \\`${sanitizedInfrastructureFailure.replace(/`/g, "\\\\`")}\\``',
    ]);
    expect(postScript).toContain('Phase: \\`${diagnosticPhase}\\`');
    expect(notifyRun).toContain(
      'Review the trusted workflow logs and the redacted ocr-review-output artifact for diagnostics.',
    );
  });

  it('preserves native failure phase in diagnostics', () => {
    expect(postScript).toContain('let diagnosticPhase = phase;');
    expect(postScript).toContain('Phase: \\`${diagnosticPhase}\\`');
    expect(postScript).not.toContain('/post-results');
    expect(postScript).not.toContain(
      'diagnosticPhase = `${phase}/post-results`',
    );
  });

  it('uploads diagnostics and telemetry only after their respective validation', () => {
    const uploadStep = stepNamed(codeReviewJob ?? {}, 'Upload OCR artifacts');
    const telemetryUploadStep = stepNamed(
      codeReviewJob ?? {},
      'Upload OCR telemetry',
    );
    expect(String(uploadStep?.if)).toContain(
      'steps.ocr-telemetry-validation.outputs.valid',
    );
    const uploadWith = getWith(uploadStep);
    expect(String(uploadWith?.path)).toContain('ocr-phase.txt');
    expect(String(uploadWith?.path)).toContain('ocr-preflight.txt');
    expect(String(uploadWith?.path)).toContain(
      'ocr-infrastructure-failure.txt',
    );
    expect(String(uploadWith?.path)).toContain('ocr-policy-failure.txt');
    expect(String(uploadWith?.path)).not.toContain('ocr-telemetry.json');
    const telemetryWith = getWith(telemetryUploadStep);
    expect(telemetryWith?.path).toBe('ocr-telemetry.json');
    expect(telemetryWith?.['if-no-files-found']).toBe('error');
  });

  it('creates non-telemetry placeholders before producing telemetry', () => {
    const uploadStep = stepNamed(codeReviewJob ?? {}, 'Upload OCR artifacts');
    const placeholderRun = commandText(
      stepNamed(codeReviewJob ?? {}, 'Ensure OCR artifact placeholders exist'),
    );
    const coverageEnsureRun = commandText(
      stepNamed(codeReviewJob ?? {}, 'Ensure valid OCR coverage report'),
    );
    const uploadWith = getWith(uploadStep);
    const uploadPath = String(uploadWith?.path ?? '');
    for (const artifact of uploadPath.trim().split(/\s+/)) {
      if (artifact === 'ocr-coverage-report.json') {
        expect(coverageEnsureRun).toContain(artifact);
      } else {
        expect(placeholderRun).toContain(artifact);
      }
    }
    expect(placeholderRun).not.toContain('ocr-telemetry.json');
  });

  it('notifies a deduplicated ci/cd issue only for classified infrastructure errors', () => {
    expect(notifyJob?.needs).toBe('classify-ocr-run');
    expect(notifyJob?.['timeout-minutes']).toBe(5);
    const concurrency = asOptionalRecord(notifyJob?.concurrency);
    expect(concurrency?.group).toBe('ocr-review-infrastructure-issue');
    expect(concurrency?.['cancel-in-progress']).toBe(false);
    expect(normalize(asOptionalString(notifyJob?.if))).toBe(
      normalize(
        "${{ needs.classify-ocr-run.result == 'success' && (needs.classify-ocr-run.outputs.classification == 'infrastructure-failure' || needs.classify-ocr-run.outputs.classification == 'unexpected-failure') }}",
      ),
    );
    expect(notifyStep?.if).toBeUndefined();
    const env = getEnv(notifyStep);
    expect(env?.GH_TOKEN).toBe('${{ github.token }}');
    expect(env?.GH_REPO).toBe('${{ github.repository }}');
    expect(env?.RUN_URL).toBe('${{ github.event.workflow_run.html_url }}');
    expect(env?.OCR_RUN_CLASSIFICATION).toBe(
      '${{ needs.classify-ocr-run.outputs.classification }}',
    );
    expect(notifierWorkflowYml).toContain(
      'ratchet:actions/download-artifact@v8',
    );
    expectContainsAll(notifyRun, [
      'notify_ocr_infrastructure_failure() {',
      'case "${OCR_RUN_CLASSIFICATION:-}" in',
      'infrastructure-failure|unexpected-failure)',
      'Refusing notification for non-infrastructure OCR classification.',
      'command -v gh >/dev/null 2>&1',
      'gh auth status >/dev/null 2>&1',
      'ISSUE_TITLE="OCR review infrastructure failure"',
      'OCR review run was classified as ${OCR_RUN_CLASSIFICATION}',
      'gh issue list',
      '--search "' +
        String.raw`\"` +
        '${ISSUE_TITLE}' +
        String.raw`\"` +
        ' in:title is:issue state:open sort:created-asc"',
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
    expect(notifyRun).not.toContain('sort:created-desc');
    expect(notifyRun.match(/sort:created-asc/g)).toHaveLength(3);
    expect(notifyRun).not.toContain('trap \'rm -f "$body_file"\' EXIT RETURN');
    expect(notifyRun).not.toContain('--label "bug"');
    expect(JSON.stringify(notifyJob)).not.toContain('secrets.');
  });

  it('uses UTC dates, backoff retries, and label fallback for infrastructure issues', () => {
    const normalizedNotifyRun = normalize(notifyRun);

    expectContainsAll(notifyRun, [
      'sleep $(( attempt * 5 ))',
      "$(TZ=UTC date +'%Y-%m-%d')",
      'create_infrastructure_issue() {',
      'local issue_body_file',
      'local create_stderr',
      'issue_body_file="$1"',
      'shift',
      'gh issue create "$@" --body-file "$issue_body_file" --label "ci/cd" 2>"${create_stderr}"',
      'if grep -Eqi "label|labels|not found|does not exist" "${create_stderr}"; then',
      'gh issue create "$@" --body-file "$issue_body_file"',
      'Failed to create OCR infrastructure issue.',
      'return 1',
      'create_infrastructure_issue "$body_file"',
      'converge_duplicate_tracking_issues',
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
