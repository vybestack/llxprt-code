/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import {
  encodeSlotSummary,
  type AnthropicSummary,
} from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { unitCount } from '@vybestack/llxprt-code-core/journal/unitContributions.js';
import type {
  RowFormatFill,
  RowFormatSettings,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import {
  AnthropicStreamRepair,
  numericRepairPiece,
  type LazyRepairAtom,
} from './anthropic-stream-repair.js';
import { anthropicUnitTransfer } from './anthropic-unit-transfer.js';

function identity(): AnthropicSummary {
  const summary = identitySlotSummary('anthropic');
  if (summary.kind !== 'anthropic')
    throw new JournalFormatError('Missing Anthropic identity');
  return summary;
}
function compose(
  left: AnthropicSummary,
  right: AnthropicSummary,
): AnthropicSummary {
  const summary = composeSlotSummaries(left, right);
  if (summary.kind !== 'anthropic')
    throw new JournalFormatError('Missing Anthropic summary');
  return summary;
}
async function atomSummary(
  atom: LazyRepairAtom,
  redact: boolean,
): Promise<AnthropicSummary> {
  let summary = identity();
  let emitted = false;
  const add = (piece: Parameters<typeof numericRepairPiece>[0]): void => {
    const fact = numericRepairPiece(piece, atom.role);
    summary = compose(
      summary,
      anthropicUnitTransfer(
        {
          speaker: atom.role === 'user' ? 'human' : 'ai',
          chainStart: false,
          hasThinking: false,
          atoms: [[fact], [fact]],
          chain: [fact, fact],
        },
        1n,
      ),
    );
  };
  for await (const piece of atom.openPieces(redact)) {
    emitted = true;
    add(piece);
  }
  if (!emitted) add([]);
  return summary;
}

export async function prepareAnthropicStoredFill(
  snapshot: VersionSnapshot,
  settings: RowFormatSettings,
): Promise<RowFormatFill> {
  const query = await IndexedJournalRequestSnapshot.create(snapshot);
  try {
    const engine = await AnthropicStreamRepair.create(query, settings);
    const iterator = engine.atoms();
    let pending = await iterator.next();
    let units = 0;
    let lastLabel = 0n;
    let lastKept = identity();
    return {
      async measure(current, entry) {
        if (current !== snapshot || entry.label <= lastLabel)
          throw new JournalFormatError(
            'Anthropic stored fill requires one ordered native row traversal',
          );
        const end = units + unitCount(entry);
        let kept = identity();
        let stripped = identity();
        let corrected = identity();
        while (pending.done !== true && pending.value.key < end * 4) {
          const atom = pending.value;
          if (atom.key < units * 4)
            throw new JournalFormatError(
              'Anthropic stored atom precedes its source row',
            );
          const withThinking = await atomSummary(atom, false);
          const withoutThinking = await atomSummary(atom, true);
          kept = compose(kept, withThinking);
          stripped = compose(stripped, withoutThinking);
          corrected = compose(
            corrected,
            Math.floor(atom.key / 4) === engine.tools.index.lastThinking
              ? withThinking
              : withoutThinking,
          );
          pending = await iterator.next();
        }
        units = end;
        lastLabel = entry.label;
        lastKept = compose(lastKept, corrected);
        const summary: AnthropicSummary = {
          kind: 'anthropic',
          variants: [kept.variants[0], stripped.variants[0]],
          cOut: [0, 0],
          lastL: [0n, 0n],
        };
        const lens = new Uint8Array(592);
        lens.set(encodeSlotSummary(summary));
        lens.set(encodeSlotSummary(corrected), 296);
        return { summary, lens };
      },
      async finish() {
        if (pending.done !== true || units !== query.count)
          throw new JournalFormatError(
            'Anthropic stored fill did not consume the complete native contribution stream',
          );
        return encodeSlotSummary(lastKept);
      },
      async close() {
        try {
          await iterator.return(undefined);
        } finally {
          await query.close();
        }
      },
    };
  } catch (error) {
    await query.close();
    throw error;
  }
}
