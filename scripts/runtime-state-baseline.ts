/*
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { portableRelativePath as relative } from './compiler-source-path.js';
import type { AuditFinding } from './check-runtime-state-boundary.js';

export interface StateBaselineEntry {
  readonly file: string;
  readonly rule: string;
  readonly declaration: string;
  readonly count: number;
}

export interface StateBaselineComparison {
  readonly unbaselined: readonly StateBaselineEntry[];
  readonly stale: readonly StateBaselineEntry[];
  readonly strictFindings: readonly AuditFinding[];
}

const ratchetedProductionRules = new Set([
  'module-mutation',
  'mutable-state',
  'process-environment-mutation',
  'async-local-storage',
  'runtime-service-bag-parameter',
  'runtime-service-bundle',
  'runtime-ambient-delegation',
]);

function entryFor(finding: AuditFinding): StateBaselineEntry {
  return {
    file: finding.file,
    rule: finding.rule,
    declaration: finding.declaration ?? '',
    count: 1,
  };
}

function key(entry: StateBaselineEntry): string {
  return JSON.stringify([entry.file, entry.rule, entry.declaration]);
}

function remainsStrict(finding: AuditFinding): boolean {
  return (
    finding.rule === 'mutable-state' &&
    /(?:^|\/)(?:runtime|api|settings)(?:\/|$)/.test(finding.file)
  );
}

function aggregateCounts(
  entries: readonly StateBaselineEntry[],
): Map<string, StateBaselineEntry> {
  const counts = new Map<string, StateBaselineEntry>();
  for (const entry of entries) {
    const entryKey = key(entry);
    const previous = counts.get(entryKey);
    counts.set(entryKey, {
      ...entry,
      count: (previous?.count ?? 0) + entry.count,
    });
  }
  return counts;
}

export function unique<T>(items: readonly T[]): T[] {
  return [
    ...new Map(items.map((item) => [JSON.stringify(item), item])).values(),
  ];
}

export function compareStateBaseline(
  findings: readonly AuditFinding[],
  baseline: readonly StateBaselineEntry[],
): StateBaselineComparison {
  const baselineByKey = aggregateCounts(baseline);
  const currentCounts = new Map<string, StateBaselineEntry>();
  const unbaselined = new Map<string, StateBaselineEntry>();
  const strictFindings: AuditFinding[] = [];

  for (const finding of findings) {
    if (!ratchetedProductionRules.has(finding.rule) || remainsStrict(finding)) {
      strictFindings.push(finding);
      continue;
    }
    const entry = entryFor(finding);
    const entryKey = key(entry);
    const current = currentCounts.get(entryKey);
    currentCounts.set(entryKey, {
      ...entry,
      count: (current?.count ?? 0) + 1,
    });
  }

  for (const [entryKey, current] of currentCounts) {
    const baselineEntry = baselineByKey.get(entryKey);
    if (current.count > (baselineEntry?.count ?? 0))
      unbaselined.set(entryKey, {
        ...current,
        count: current.count - (baselineEntry?.count ?? 0),
      });
  }

  const stale = [...baselineByKey].flatMap(([entryKey, baselineEntry]) => {
    const currentCount = currentCounts.get(entryKey)?.count ?? 0;
    return currentCount < baselineEntry.count
      ? [{ ...baselineEntry, count: baselineEntry.count - currentCount }]
      : [];
  });

  return {
    unbaselined: [...unbaselined.values()].sort((a, b) =>
      key(a).localeCompare(key(b)),
    ),
    stale: stale.sort((a, b) => key(a).localeCompare(key(b))),
    strictFindings,
  };
}

export function compareStateBaselineFile(
  baselinePath: string,
  findings: readonly AuditFinding[],
): StateBaselineComparison {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
    findings: StateBaselineEntry[];
  };
  return compareStateBaseline(findings, baseline.findings);
}

export function writeStateBaselineDrift(
  comparison: StateBaselineComparison | undefined,
  write: (message: string) => void,
): void {
  if (comparison?.unbaselined.length)
    write(
      `Unbaselined widened runtime-state findings:\n${comparison.unbaselined
        .map((entry) => `${entry.file} ${entry.rule} ${entry.declaration}`)
        .join('\n')}\n`,
    );
  if (comparison?.stale.length)
    write(
      `Stale widened runtime-state baseline entries; remove these from the baseline:\n${comparison.stale
        .map((entry) => `${entry.file} ${entry.rule} ${entry.declaration}`)
        .join('\n')}\n`,
    );
}

export function normalizeFindings(
  workspace: string,
  findings: ReadonlyArray<Omit<AuditFinding, 'owner'>>,
): AuditFinding[] {
  return unique(findings)
    .map((finding) => {
      const file = relative(workspace, finding.file).split(sep).join('/');
      return { ...finding, file, owner: file.split('/')[1] ?? 'workspace' };
    })
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.column - b.column ||
        a.rule.localeCompare(b.rule),
    );
}

export function auditExitCode(
  comparison: StateBaselineComparison | undefined,
  findingCount: number,
  diagnosticCount: number,
): number {
  const findingsRemain = comparison
    ? comparison.unbaselined.length > 0 ||
      comparison.stale.length > 0 ||
      comparison.strictFindings.length > 0
    : findingCount > 0;
  return findingsRemain || diagnosticCount > 0 ? 1 : 0;
}
