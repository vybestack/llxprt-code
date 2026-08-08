/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BoundaryResult, PackageCount } from './types.js';

/** Computes per-package and total member counts from the holder list. */
export function rollupByPackage(
  holders: ReadonlyArray<{
    readonly file: string;
    readonly packageName: string;
    readonly members: ReadonlySet<string>;
  }>,
): { perPackage: PackageCount[]; totalFiles: number; totalMembers: number } {
  const byPackage = new Map<
    string,
    { files: Set<string>; members: Set<string> }
  >();
  for (const holder of holders) {
    const bucket = byPackage.get(holder.packageName) ?? {
      files: new Set<string>(),
      members: new Set<string>(),
    };
    bucket.files.add(holder.file);
    for (const member of holder.members) bucket.members.add(member);
    byPackage.set(holder.packageName, bucket);
  }
  const perPackage: PackageCount[] = [];
  const allMembers = new Set<string>();
  for (const [packageName, bucket] of byPackage) {
    perPackage.push({
      packageName,
      files: bucket.files.size,
      members: bucket.members.size,
    });
    for (const member of bucket.members) allMembers.add(member);
  }
  perPackage.sort(
    (a, b) => b.files - a.files || a.packageName.localeCompare(b.packageName),
  );
  return {
    perPackage,
    totalFiles: holders.length,
    totalMembers: allMembers.size,
  };
}

/** Formats the human-readable guard report. */
export function formatReport(result: BoundaryResult): string {
  const lines: string[] = [];
  const mode = result.enforce ? 'enforce' : 'report-only';
  lines.push(`config-boundary: scanning ${result.root} (${mode})`);

  lines.push(
    `config-boundary: holders ${result.totalFiles} files, ${result.totalMembers} distinct members`,
  );
  for (const pkg of result.perPackage) {
    lines.push(
      `config-boundary: package ${pkg.packageName} ${pkg.files} files, ${pkg.members} members`,
    );
  }

  lines.push(
    `config-boundary: config-type import findings ${result.findings.length}`,
  );
  for (const finding of result.findings) {
    lines.push(`config-boundary: finding ${finding.file} imports Config type`);
  }

  lines.push(
    `config-boundary: role service-locator violations ${result.roleViolations.length}`,
  );
  for (const violation of result.roleViolations) {
    lines.push(
      `config-boundary: role-violation ${violation.file} ${violation.member}`,
    );
  }

  for (const error of result.parseErrors) {
    lines.push(`config-boundary: parse-error ${error.file} ${error.message}`);
  }

  return lines.join('\n');
}
