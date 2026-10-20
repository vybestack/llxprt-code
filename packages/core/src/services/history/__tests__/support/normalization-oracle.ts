/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { DebugLogger } from '../../../../debug/index.js';
import { isCuratedContent } from '../../historyCuration.js';
import { prepareProviderContentSnapshot } from '../../provider-curated-stream.js';
import type { IContent } from '../../IContent.js';
import type { UnitCase } from './normalization-cases.js';

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function oldUnits(input: UnitCase): Promise<{
  readonly inputHash: string;
  readonly outputHash: string;
  readonly count: number;
  readonly pending: readonly boolean[];
  readonly firstOutputIndex: number | undefined;
}> {
  async function* curated(): AsyncGenerator<IContent> {
    for (const row of input.rows) if (isCuratedContent(row)) yield row;
  }
  const snapshot = await prepareProviderContentSnapshot(
    curated(),
    input.tail,
    new DebugLogger('unit-oracle'),
  );
  try {
    const rows: IContent[] = [];
    for await (const row of snapshot.openReader()) rows.push(row);
    return {
      inputHash: digest(input),
      outputHash: digest(rows),
      count: snapshot.count,
      pending: rows.map((_, index) => snapshot.isPending(index)),
      firstOutputIndex: snapshot.pending.firstOutputIndex,
    };
  } finally {
    snapshot.close();
  }
}

export async function collectUnits(
  rows: AsyncIterable<IContent>,
): Promise<IContent[]> {
  const units: IContent[] = [];
  for await (const row of rows) units.push(row);
  return units;
}
