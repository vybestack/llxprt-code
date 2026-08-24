/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single-purpose internal validator for the pinned acplint v0.2.0 report.
 *
 * Usage: node scripts/validate-acplint-report.ts <report-json-path> <status>
 * Exit 0 = valid, exit 1 = invalid.
 *
 * Before deciding pass or fail the validator prints a human-readable markdown
 * summary to stdout and appends it to the file named by GITHUB_STEP_SUMMARY when
 * that variable is set, so failing runs surface status, findings, and agent
 * identification instead of a bare red check.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { z } from 'zod';

const SELECTED_CATEGORIES = [
  'initialization',
  'session_lifecycle',
  'schema_validation',
] as const;

type SelectedCategory = (typeof SELECTED_CATEGORIES)[number];

const EXPECTED_RESULT_ROWS = {
  initialization: [
    'initialize_v1',
    'protocol_version_returned',
    'agent_capabilities_present',
    'agent_info_present',
    'agent_capabilities_schema_valid',
  ],
  session_lifecycle: [
    'new_session',
    'list_sessions',
    'load_session',
    'resume_session',
    'close_session',
    'delete_session',
    'fork_session',
  ],
  schema_validation: [
    'schema_initialize',
    'schema_session_new',
    'schema_session_list',
    'coverage_methods_exercised',
  ],
} as const satisfies Readonly<Record<SelectedCategory, readonly string[]>>;

const ACCEPTED_ROW_STATUSES = new Set(['PASS', 'SKIP']);

/**
 * The exact finding strings the three selected deterministic categories cannot avoid
 * producing on pinned acplint v0.2.0. Each is written with the U+26A0
 * WARNING SIGN as the escaped form, and the two notification findings reproduce the
 * U+2014 EM DASH from acplint's `_assemble_findings` output byte for byte.
 * Any finding outside this list fails the gate so a new ACP gap surfaces as a red
 * check. The pre-fix agentInfo finding is deliberately absent; REQ-3095-001 is
 * enforced here instead of by hope.
 */
const ALLOWED_FINDINGS: readonly string[] = Object.freeze([
  '\u26A0 No agent_thought_chunk notifications received at all',
  "\u26A0 No available_commands_update notifications received \u2014 agent doesn't advertise commands/hooks",
  "\u26A0 No usage_update notifications received \u2014 agent doesn't report usage",
]);

const ResultRowSchema = z
  .object({
    name: z.string().min(1),
    category: z.string().min(1),
    status: z.enum(['PASS', 'FAIL', 'SKIP', 'ERROR']),
    duration_ms: z.number().nonnegative(),
    message: z.string().nullable(),
    details: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

const CategorySummarySchema = z
  .object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    errored: z.number().int().nonnegative(),
    pass_rate: z.number().min(0).max(1),
  })
  .strict();

/**
 * `agent_info` is acplint's echo of the agent's `initialize` response, so name and
 * version are optional at the schema layer: an agent that never identified itself
 * yields `{}`. Requiring them here would divert that exact regression into the
 * unparseable-report path and lose the summary. Non-emptiness is enforced in
 * `validateAgentInfo` instead (REQ-3095-004), after the summary has been emitted.
 * Extra agent-provided keys remain permitted.
 */
const AgentInfoSchema = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
  })
  .passthrough();

const AcplintReportSchema = z
  .object({
    conformance_level: z.enum([
      'Full Conformance',
      'Partial Conformance',
      'Non-Conformant',
    ]),
    agent_info: AgentInfoSchema,
    findings: z.array(z.string()),
    results: z.array(ResultRowSchema),
    summary: z.record(z.string(), CategorySummarySchema),
  })
  .strict();

type AcplintReport = z.infer<typeof AcplintReportSchema>;
type AcplintResultRow = z.infer<typeof ResultRowSchema>;
type ConformanceLevel = AcplintReport['conformance_level'];

/**
 * Renders the per-category counts present in the report, selected categories first in
 * a fixed order and any unexpected keys after, alphabetically. Uses the report's own
 * summary map so a missing category key cannot crash the summary emission.
 */
function categorySummaryRows(report: AcplintReport): string[] {
  const ordered = new Set<string>([
    ...SELECTED_CATEGORIES,
    ...Object.keys(report.summary).sort(),
  ]);
  const rows: string[] = [];
  for (const key of ordered) {
    const summary = report.summary[key];
    if (summary === undefined) {
      continue;
    }
    rows.push(
      `| ${key} | ${summary.passed} | ${summary.failed} | ${summary.skipped} | ${summary.errored} |`,
    );
  }
  return rows;
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

/**
 * Renders the agent's self-identification for the summary. A report where acplint
 * recorded no usable name or version reads "not reported" rather than being dropped,
 * so the summary still explains why the run is about to be rejected.
 */
function formatAgentIdentification(agentInfo: AcplintReport['agent_info']) {
  const { name, version } = agentInfo;
  if (!isNonEmpty(name) || !isNonEmpty(version)) {
    return 'not reported';
  }
  return `name=\`${name}\` version=\`${version}\``;
}

/**
 * The human-readable markdown summary emitted on every run before the pass/fail
 * decision: raw status, conformance level, agent identification (or "not reported"),
 * per-category counts, every finding marked known or UNEXPECTED, and every result
 * row that carries a message.
 */
function buildSummary(report: AcplintReport, status: number): string {
  const identified = formatAgentIdentification(report.agent_info);

  const findings = report.findings.map((finding) => {
    const mark = ALLOWED_FINDINGS.includes(finding) ? 'known' : 'UNEXPECTED';
    return `- [${mark}] ${finding}`;
  });

  const messages = report.results
    .filter((row) => row.message !== null)
    .map((row) => `- \`${row.category}/${row.name}\`: ${row.message}`);

  return [
    '## ACP conformance report',
    '',
    `Raw acplint status: \`${String(status)}\``,
    `Declared conformance: \`${report.conformance_level}\``,
    `Agent identification: ${identified}`,
    '',
    '### Per-category counts',
    '',
    '| Category | Passed | Failed | Skipped | Errored |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...categorySummaryRows(report),
    '',
    `### Findings (${report.findings.length})`,
    '',
    ...(findings.length === 0 ? ['None.'] : findings),
    '',
    `### Result messages (${messages.length})`,
    '',
    ...(messages.length === 0 ? ['None.'] : messages),
    '',
  ].join('\n');
}

/**
 * The short summary emitted when the report cannot be read or parsed: it exists so
 * even an unavailable report surfaces an inspectable trace instead of silence.
 */
function buildUnavailableSummary(reason: string): string {
  return [
    '## ACP conformance report',
    '',
    'The acplint report was unavailable and could not be validated.',
    '',
    `Reason: \`${reason}\``,
    '',
  ].join('\n');
}

/**
 * Writes the summary to stdout always and appends it (never truncating) to the
 * file named by GITHUB_STEP_SUMMARY when that variable is set and non-empty.
 */
function emitSummary(markdown: string): void {
  process.stdout.write(markdown);
  process.stdout.write('\n');
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (typeof summaryPath === 'string' && summaryPath.length > 0) {
    appendFileSync(summaryPath, `${markdown}\n`);
  }
}

function validateSummaryKeys(report: AcplintReport): void {
  const actual = Object.keys(report.summary).sort();
  const expected = [...SELECTED_CATEGORIES].sort();
  if (
    actual.length !== expected.length ||
    !actual.every((key, index) => key === expected[index])
  ) {
    throw new Error(
      `summary keys [${actual.join(', ')}] do not match expected [${expected.join(', ')}]`,
    );
  }
}

function validateCategoryRows(
  rows: readonly AcplintResultRow[],
  category: SelectedCategory,
): void {
  const expectedNames = new Set<string>(EXPECTED_RESULT_ROWS[category]);
  const seenNames = new Set<string>();
  for (const row of rows) {
    if (!expectedNames.has(row.name)) {
      throw new Error(
        `unexpected result row ${row.name} in category ${category}`,
      );
    }
    if (seenNames.has(row.name)) {
      throw new Error(
        `duplicate result row ${row.name} in category ${category}`,
      );
    }
    if (!ACCEPTED_ROW_STATUSES.has(row.status)) {
      throw new Error(
        `selected result ${row.name} (${category}) has rejected status ${row.status}`,
      );
    }
    seenNames.add(row.name);
  }
  for (const name of expectedNames) {
    if (!seenNames.has(name)) {
      throw new Error(`missing result row ${name} in category ${category}`);
    }
  }
}

function validateCategory(
  report: AcplintReport,
  category: SelectedCategory,
): number {
  const rows = report.results.filter((row) => row.category === category);
  validateCategoryRows(rows, category);
  const summary = report.summary[category];
  if (summary === undefined) {
    throw new Error(`missing summary for category ${category}`);
  }
  const passed = rows.filter((row) => row.status === 'PASS').length;
  const skipped = rows.filter((row) => row.status === 'SKIP').length;
  const passRate = passed / rows.length;
  const actualSummary = [
    summary.passed,
    summary.failed,
    summary.skipped,
    summary.errored,
    summary.pass_rate,
  ];
  const expectedSummary = [passed, 0, skipped, 0, passRate];
  if (
    !actualSummary.every((value, index) => value === expectedSummary[index])
  ) {
    throw new Error(`summary does not match results for category ${category}`);
  }
  return passed;
}

function conformanceLevelFor(passRate: number): ConformanceLevel {
  if (passRate >= 0.95) {
    return 'Full Conformance';
  }
  if (passRate >= 0.7) {
    return 'Partial Conformance';
  }
  return 'Non-Conformant';
}

/**
 * A finding outside the allowlist is a defect the selected categories cannot explain,
 * so it fails the gate and the error names the offending finding.
 */
function validateFindings(report: AcplintReport): void {
  for (const finding of report.findings) {
    if (!ALLOWED_FINDINGS.includes(finding)) {
      throw new Error(`unexpected acplint finding: ${finding}`);
    }
  }
}

function validate(report: AcplintReport, status: number): void {
  if (status !== 0 && status !== 1) {
    throw new Error(`unexpected status ${status} (only 0 or 1 accepted)`);
  }
  const expectedLevel =
    status === 0 ? 'Full Conformance' : 'Partial Conformance';
  if (report.conformance_level !== expectedLevel) {
    throw new Error(
      `status ${status} requires "${expectedLevel}" but got "${report.conformance_level}"`,
    );
  }

  const selectedCategories = new Set<string>(SELECTED_CATEGORIES);
  const unexpected = report.results.find(
    (row) => !selectedCategories.has(row.category),
  );
  if (unexpected !== undefined) {
    throw new Error(`unexpected category ${unexpected.category} in results`);
  }
  validateSummaryKeys(report);

  const totalPassed = SELECTED_CATEGORIES.reduce(
    (sum, category) => sum + validateCategory(report, category),
    0,
  );
  const derivedLevel = conformanceLevelFor(totalPassed / report.results.length);
  if (report.conformance_level !== derivedLevel) {
    throw new Error(
      `results require "${derivedLevel}" but report declares "${report.conformance_level}"`,
    );
  }

  validateAgentInfo(report);
  validateFindings(report);
}

/**
 * The agent must identify itself (REQ-3095-004). A report where acplint recorded no
 * name or version means the `initialize` response carried no usable `agentInfo`.
 */
function validateAgentInfo(report: AcplintReport): void {
  const { name, version } = report.agent_info;
  if (!isNonEmpty(name)) {
    throw new Error('agent_info.name must be a non-empty string');
  }
  if (!isNonEmpty(version)) {
    throw new Error('agent_info.version must be a non-empty string');
  }
}

/**
 * Emits the unavailable summary naming the failure, then marks the exit code without
 * terminating the process, so Node drains buffered stdout before the process ends and a large
 * summary is never truncated at the pipe buffer boundary.
 */
function rejectUnavailable(reason: string): void {
  process.stderr.write(`${reason}\n`);
  emitSummary(buildUnavailableSummary(reason));
  process.exitCode = 1;
}

/**
 * Fails a run whose full summary was already emitted before the decision: the reason goes to
 * stderr and the exit code is marked without terminating the process, so buffered stdout is
 * drained and a large summary is never truncated at the pipe buffer boundary.
 */
function rejectValidated(reason: string): void {
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    rejectUnavailable(
      `invalid invocation: expected exactly 2 arguments (<report-json-path> <status>), got ${args.length}`,
    );
    return;
  }
  const [reportPath, statusArg] = args;
  if (!/^[0-9]+$/.test(statusArg)) {
    rejectUnavailable(
      `invalid status "${statusArg}": expected a non-negative integer`,
    );
    return;
  }
  const status = Number(statusArg);

  let jsonText: string;
  try {
    jsonText = readFileSync(reportPath, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    rejectUnavailable(`failed to read report file: ${reason}`);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    rejectUnavailable(`failed to parse report JSON: ${reason}`);
    return;
  }

  const parseResult = AcplintReportSchema.safeParse(parsed);
  if (!parseResult.success) {
    rejectUnavailable(`report validation failed: ${parseResult.error.message}`);
    return;
  }

  const report = parseResult.data;
  emitSummary(buildSummary(report, status));

  try {
    validate(report, status);
  } catch (error) {
    rejectValidated(
      `report validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  process.stdout.write('acplint report validated successfully\n');
}

main();
