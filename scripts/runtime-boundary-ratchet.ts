/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AuditFinding,
  AuditResult,
} from './check-runtime-state-boundary.js';

/**
 * Rules whose production residual is tracked by a committed baseline and may
 * only shrink. Every other rule must report zero findings.
 */
export const ratchetedRules: readonly string[] = [
  'runtime-service-bundle',
  'runtime-service-bag-parameter',
];

export type RatchetCounts = Readonly<
  Record<string, Readonly<Record<string, number>>>
>;

export interface RatchetBaseline {
  readonly counts: RatchetCounts;
}

export interface RatchetIncrease {
  readonly owner: string;
  readonly rule: string;
  readonly baseline: number;
  readonly actual: number;
}

export interface RatchetVerdict {
  readonly exitCode: 0 | 1;
  readonly unratchetedFindings: readonly AuditFinding[];
  readonly increases: readonly RatchetIncrease[];
  readonly decreases: readonly RatchetIncrease[];
  readonly compilerDiagnosticCount: number;
}

/**
 * Human-readable list of every compiler diagnostic, grouped by the program
 * (compiler config) that produced it, plus any scanner that did not complete.
 * The ratchet verdict only carries a count, so without this a CI failure
 * would not say which diagnostic blocked the audit. Empty when nothing blocks.
 */
export function formatBlockedAudit(
  result: Pick<AuditResult, 'programs' | 'scanners'>,
): string {
  const lines: string[] = [];
  for (const program of result.programs) {
    for (const problem of program.compilerDiagnostics) {
      const location = problem.file
        ? `${problem.file}:${problem.line ?? 0}:${problem.column ?? 0}`
        : '(no file)';
      lines.push(
        `[${program.compilerConfig}] ${location} ${problem.category} TS${problem.code}: ${problem.message}`,
      );
    }
  }
  if (lines.length === 0) return '';
  const { serviceShape, ambientDelegation } = result.scanners;
  if (serviceShape !== 'complete')
    lines.push(`scanner serviceShape: ${serviceShape}`);
  if (ambientDelegation !== 'complete')
    lines.push(`scanner ambientDelegation: ${ambientDelegation}`);
  return `runtime-boundary audit blocked by compiler diagnostics:\n${lines.join('\n')}\n`;
}

export function parseRatchetBaseline(text: string): RatchetBaseline {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || !('counts' in parsed))
    throw new Error('Ratchet baseline must be an object with "counts"');
  const { counts } = parsed;
  if (typeof counts !== 'object' || counts === null || Array.isArray(counts))
    throw new Error('Ratchet baseline "counts" must be an object');
  for (const [owner, rules] of Object.entries(counts)) {
    if (typeof rules !== 'object' || rules === null || Array.isArray(rules))
      throw new Error(`Ratchet baseline owner "${owner}" must be an object`);
    for (const [rule, count] of Object.entries(rules)) {
      if (!ratchetedRules.includes(rule))
        throw new Error(
          `Ratchet baseline may only record ${ratchetedRules.join(', ')}; found "${rule}" for "${owner}"`,
        );
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0)
        throw new Error(
          `Ratchet baseline count for "${owner}"/"${rule}" must be a non-negative integer`,
        );
    }
  }
  return { counts: counts as RatchetCounts };
}

export function ratchetCountsFromResult(
  result: Pick<AuditResult, 'findings'>,
): RatchetCounts {
  const counts: Record<string, Record<string, number>> = {};
  for (const finding of result.findings) {
    if (!ratchetedRules.includes(finding.rule)) continue;
    const owner = (counts[finding.owner] ??= {});
    owner[finding.rule] = (owner[finding.rule] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map((owner) => [
        owner,
        Object.fromEntries(
          Object.entries(counts[owner]).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ]),
  );
}

export function evaluateRatchet(
  result: Pick<AuditResult, 'findings' | 'compilerDiagnostics'>,
  baseline: RatchetBaseline,
): RatchetVerdict {
  const unratchetedFindings = result.findings.filter(
    (finding) => !ratchetedRules.includes(finding.rule),
  );
  const actual = ratchetCountsFromResult(result);
  const keys = new Set<string>();
  for (const counts of [actual, baseline.counts])
    for (const [owner, rules] of Object.entries(counts))
      for (const rule of Object.keys(rules)) keys.add(`${owner}\0${rule}`);
  const increases: RatchetIncrease[] = [];
  const decreases: RatchetIncrease[] = [];
  for (const key of [...keys].sort()) {
    const [owner, rule] = key.split('\0');
    const entry = {
      owner,
      rule,
      baseline: baseline.counts[owner]?.[rule] ?? 0,
      actual: actual[owner]?.[rule] ?? 0,
    };
    if (entry.actual > entry.baseline) increases.push(entry);
    if (entry.actual < entry.baseline) decreases.push(entry);
  }
  const failed =
    unratchetedFindings.length > 0 ||
    increases.length > 0 ||
    result.compilerDiagnostics.length > 0;
  return {
    exitCode: failed ? 1 : 0,
    unratchetedFindings,
    increases,
    decreases,
    compilerDiagnosticCount: result.compilerDiagnostics.length,
  };
}
