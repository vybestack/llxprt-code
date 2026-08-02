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
 */

import { readFileSync } from 'node:fs';
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

const AcplintReportSchema = z
  .object({
    conformance_level: z.enum([
      'Full Conformance',
      'Partial Conformance',
      'Non-Conformant',
    ]),
    agent_info: z.record(z.string(), z.unknown()),
    findings: z.array(z.string()),
    results: z.array(ResultRowSchema),
    summary: z.record(z.string(), CategorySummarySchema),
  })
  .strict();

type AcplintReport = z.infer<typeof AcplintReportSchema>;
type AcplintResultRow = z.infer<typeof ResultRowSchema>;
type ConformanceLevel = AcplintReport['conformance_level'];

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
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    process.stderr.write(
      'usage: node scripts/validate-acplint-report.ts <report-json-path> <status>\n',
    );
    process.exit(1);
  }
  const [reportPath, statusArg] = args;
  if (!/^[0-9]+$/.test(statusArg)) {
    process.stderr.write(`invalid status: ${statusArg}\n`);
    process.exit(1);
  }
  const status = Number(statusArg);

  let jsonText: string;
  try {
    jsonText = readFileSync(reportPath, 'utf8');
  } catch (error) {
    process.stderr.write(
      `failed to read report file: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    process.stderr.write(
      `failed to parse report JSON: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  const parseResult = AcplintReportSchema.safeParse(parsed);
  if (!parseResult.success) {
    process.stderr.write(
      `report validation failed: ${parseResult.error.message}\n`,
    );
    process.exit(1);
  }

  try {
    validate(parseResult.data, status);
  } catch (error) {
    process.stderr.write(
      `report validation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  process.stdout.write('acplint report validated successfully\n');
}

main();
