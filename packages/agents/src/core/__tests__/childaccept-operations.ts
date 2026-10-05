/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export type ChildOperation =
  | { kind: 'append'; row: IContent }
  | { kind: 'rewind' }
  | { kind: 'compression'; summary: IContent }
  | { kind: 'replacement'; rows: IContent[] }
  | { kind: 'density'; remove: number; replace: number; row: IContent };

export function textRow(text: string, ai = false): IContent {
  return { speaker: ai ? 'ai' : 'human', blocks: [{ type: 'text', text }] };
}

export function seededOperations(seed: number): ChildOperation[] {
  let state = seed;
  const label = (): string => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return `seed-${seed}-${state}`;
  };
  const operations: ChildOperation[] = [];
  for (let cycle = 0; cycle < 3; cycle += 1) {
    operations.push(
      { kind: 'append', row: textRow(label()) },
      { kind: 'append', row: textRow(label(), true) },
      { kind: 'append', row: textRow(label()) },
      { kind: 'rewind' },
      { kind: 'append', row: textRow(label()) },
      { kind: 'density', remove: 1, replace: 0, row: textRow(label()) },
      { kind: 'compression', summary: textRow(`summary-${label()}`) },
      { kind: 'append', row: textRow(label(), true) },
      { kind: 'rewind' },
      { kind: 'replacement', rows: [textRow(label()), textRow(label(), true)] },
    );
  }
  return operations;
}

export function eagerFold(
  rows: readonly IContent[],
  op: ChildOperation,
): IContent[] {
  switch (op.kind) {
    case 'append':
      return [...rows, op.row];
    case 'rewind':
      return rows.slice(0, -1);
    case 'compression':
      return [op.summary];
    case 'replacement':
      return [...op.rows];
    case 'density':
      return rows
        .map((row, index) => (index === op.replace ? op.row : row))
        .filter((_row, index) => index !== op.remove);
    default:
      throw new Error(`Unknown operation: ${JSON.stringify(op)}`);
  }
}

export async function applyChildOperation(
  history: HistoryService,
  op: ChildOperation,
): Promise<void> {
  switch (op.kind) {
    case 'append':
      history.add(structuredClone(op.row));
      break;
    case 'rewind':
      await history.pop();
      break;
    case 'compression':
      await history.replaceAll([structuredClone(op.summary)]);
      break;
    case 'replacement':
      await history.replaceAll(structuredClone(op.rows));
      break;
    case 'density':
      await history.applyDensityResult({
        removals: [op.remove],
        replacements: new Map([[op.replace, structuredClone(op.row)]]),
        metadata: {
          readWritePairsPruned: 0,
          fileDeduplicationsPruned: 0,
          recencyPruned: 1,
        },
      });
      break;
    default:
      throw new Error(`Unknown operation: ${JSON.stringify(op)}`);
  }
  await history.waitForCommit();
  await history.waitForTokenUpdates();
  await history.waitForOwnershipSettlement();
}

export function referenceBody(
  rows: readonly IContent[],
  resume = false,
): string {
  let parentIndex = -1;
  if (!resume) {
    for (let index = 0; index < rows.length; index += 1) {
      if (
        rows[index].speaker === 'ai' &&
        rows[index].metadata?.responsesStored === true
      )
        parentIndex = index;
    }
  }
  const input = rows.slice(parentIndex + 1).flatMap((row) => {
    const text = row.blocks
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join(row.speaker === 'human' ? '\n' : '');
    if (text.length === 0) return [];
    return [
      { role: row.speaker === 'human' ? 'user' : 'assistant', content: text },
    ];
  });
  return JSON.stringify({
    model: 'gpt-5.2',
    input,
    stream: true,
    instructions: 'child acceptance',
    store: true,
    ...(parentIndex < 0
      ? {}
      : { previous_response_id: rows[parentIndex].metadata?.id }),
  });
}
