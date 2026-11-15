/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

type Obj = Record<string, unknown>;
type Run = Obj;

export function formatRefusalSurvey(report: Obj): string {
  const summary = report['summary'] as Obj;
  const runs = report['runs'] as Run[];
  const sections: string[] = [
    `Refusal survey: ${summary['refusalAttempts']} attempts in ${summary['runs']} runs (${summary['definite']} definite, ${summary['suspected']} suspected)`,
  ];
  for (const [title, values] of [
    ['By model:', summary['models']],
    ['By category:', summary['categories']],
    ['By project:', summary['projects']],
  ] as const) {
    sections.push(title);
    for (const [key, count] of Object.entries(
      values as Record<string, number>,
    ).sort())
      sections.push(
        `  ${title === 'By category:' ? 'Category: ' : ''}${key}: ${count}`,
      );
  }
  sections.push(
    'Compression correlation: calls within 60 seconds after the latest compression are after-compression, older matched calls are elsewhere, and calls with no matched prior compression are missing-evidence; denominators count all observed provider calls in each bucket.',
  );
  const compression = summary['compression'] as Record<
    string,
    { attempts: number; refusals: number }
  >;
  for (const [name, count] of Object.entries(compression)) {
    const rate =
      count.attempts === 0
        ? 'n/a'
        : `${((count.refusals / count.attempts) * 100).toFixed(1)}%`;
    sections.push(
      `  ${name}: ${count.refusals}/${count.attempts} calls had refusals (${rate})`,
    );
  }
  for (const run of runs) {
    sections.push(
      `\n${run['firstTime']} ${run['model']} category=${run['category'] ?? 'unspecified'} project=${run['project']} session=${run['session']} prompt=${run['promptId']} attempts=${run['refusalAttempts']} context=${run['contextTokens'] ?? 'unknown'} compression=${run['compression'] ?? 'none'} recovery=${run['recovery']}`,
    );
    sections.push(
      `  Entries since compression: ${run['entriesSinceCompression'] ?? 'unknown'}; summary author: ${run['summaryAuthor'] ?? 'unknown'}`,
    );
    for (const entry of run['newestEntriesBeforeRefusal'] as string[])
      sections.push(`  Before: ${entry}`);
    if (run['partialOutput'] !== null)
      sections.push(
        `  Partial output: ${JSON.stringify(run['partialOutput'])}`,
      );
    sections.push(
      `  Terms more common in refused window: ${(run['overrepresentedTerms'] as string[]).join(', ') || 'none'}`,
    );
    sections.push(`  Dump pairs: ${JSON.stringify(run['dumpPairs'])}`);
  }
  sections.push(
    `Malformed lines: ${(report['diagnostics'] as Obj)['malformedLines']}`,
  );
  return `${sections.join('\n')}\n`;
}
