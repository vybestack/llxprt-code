/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export async function main(): Promise<void> {
  const { INSTALLED_ANALYZE_USAGE, runAnalyzeCli } = await import(
    './heapanalyze.ts'
  );

  runAnalyzeCli(INSTALLED_ANALYZE_USAGE);
}
