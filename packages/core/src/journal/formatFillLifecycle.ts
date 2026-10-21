/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { SlotTable } from './slotTable.js';
import type { VersionEdit } from './groupEdits.js';
import type { BuildContext, BuiltGroup } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import { KeyedMapBatch, KeyedMapReader } from './keyedMap.js';
import {
  rowFormatAuxKey,
  rowFormatKey,
  type RowFormatFill,
  type RowFormatRegistration,
} from './rowFormat.js';

export function requireIncrementalFormats(
  edits: readonly VersionEdit[],
  registrations: ReadonlyArray<{
    readonly registration: RowFormatRegistration;
  }>,
  slots: SlotTable | undefined,
): void {
  const changed = edits.some(
    (edit) =>
      ![
        'format',
        'toolRanking',
        'factIndex',
        'setState',
        'checkpoint',
        'deleteCheckpoint',
      ].includes(edit.kind),
  );
  if (!changed) return;
  const anthropic =
    slots?.formatSlots.filter((format) => format.summaryKind === 'anthropic') ??
    [];
  const hasUnattachedAnthropic =
    anthropic.length > 0 &&
    !registrations.some(({ registration }) =>
      anthropic.some(
        (format) =>
          rowFormatKey(registration.settings) === format.formatKeyHash,
      ),
    );
  if (
    hasUnattachedAnthropic ||
    registrations.some(
      ({ registration }) => registration.incremental === 'unsupported',
    )
  )
    throw new JournalFormatError(
      'Stored format incremental holder maintenance is not implemented; this measured version cannot accept history mutations',
    );
}

export function invalidateAnthropicFormats(
  built: BuiltGroup,
  key?: bigint,
): BuiltGroup {
  const advance = (
    slot: SlotTable['formatSlots'][number],
  ): SlotTable['formatSlots'][number] => {
    if (
      slot.summaryKind !== 'anthropic' ||
      (key !== undefined && slot.formatKeyHash !== key)
    )
      return slot;
    if (slot.gen === 0xffff_ffff)
      throw new JournalFormatError('Format generation overflow');
    return { ...slot, gen: slot.gen + 1 };
  };
  const slots = built.state.slots;
  return {
    ...built,
    state: {
      ...built.state,
      slots: {
        ...slots,
        formatSlots: [
          advance(slots.formatSlots[0]),
          advance(slots.formatSlots[1]),
          advance(slots.formatSlots[2]),
        ],
      },
    },
  };
}

export async function finishFormatFill(
  ctx: BuildContext,
  appender: RecordAppender,
  built: BuiltGroup,
  slot: number,
  fill: RowFormatFill,
): Promise<BuiltGroup> {
  const bytes = await fill.finish();
  await appender.drain();
  const reader = new KeyedMapReader(
    ctx.readGroup(appender.nextOffset),
    ctx.metaCache,
    'meta',
    ctx.hasher,
  );
  const batch = new KeyedMapBatch(reader, built.state.metaRoot);
  const format = built.state.slots.formatSlots[slot];
  const value = new Uint8Array(16 + bytes.byteLength);
  const header = new DataView(value.buffer);
  header.setBigUint64(0, format.formatKeyHash, true);
  header.setUint32(8, format.gen, true);
  header.setUint32(12, format.formatRev, true);
  value.set(bytes, 16);
  batch.set(rowFormatAuxKey(slot), value);
  return {
    ...built,
    state: { ...built.state, metaRoot: await batch.commit(appender) },
  };
}
