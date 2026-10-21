/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  finishFormatFill,
  invalidateAnthropicFormats,
} from './formatFillLifecycle.js';
import type { Aggregate } from './aggregate.js';
import type { Triple } from './bytes.js';
import { JournalFormatError } from './errors.js';
import type { RecordAppender } from './groupAppender.js';
import type { BuildContext, BuiltGroup } from './groupBuildShared.js';
import type { VersionEdit } from './groupEdits.js';
import { KeyedMapBatch, KeyedMapReader } from './keyedMap.js';
import { decodeDecimal, encodeDecimal } from './metaFacts.js';
import { decodeMistralSlots, MISTRAL_SLOTS_KEY } from './mistralMapping.js';
import { PinLease, PinnedRead } from './pinLease.js';
import { RECORD_KIND } from './recordKinds.js';
import type { RowEntry } from './rowEntry.js';
import { repairResponsesPairChanges } from './responsesPairChanges.js';
import { rowAlgebra } from './rowAlgebra.js';
import { bulkBuildRowTree } from './rowTreeBuilder.js';
import { editRowTree } from './rowTreeEdit.js';
import { iterateRowEntries, readRowTreeNode } from './rowTreeReader.js';
import {
  captureRowFormat,
  rowFormatKey,
  type RowFormatRegistration,
} from './rowFormat.js';
import { encodeSlotSummary } from './slotSummary.js';
import type { FormatSlot, SlotTable } from './slotTable.js';
import { genesisVersion, slotKindsOf } from './version.js';
import { VersionSnapshot } from './versionSnapshot.js';

export interface RegisteredRowFormat {
  readonly key: bigint;
  readonly registration: RowFormatRegistration;
}

export async function warmRowFormat(
  ctx: BuildContext,
  edits: readonly VersionEdit[],
  registry: readonly RegisteredRowFormat[],
): Promise<readonly RegisteredRowFormat[] | undefined> {
  const edit = edits[0];
  const version = ctx.published;
  if (
    edits.length !== 1 ||
    edit.kind !== 'format' ||
    version === undefined ||
    ctx.access === undefined
  )
    return undefined;
  const registration = captureRowFormat(edit.registration);
  const key = rowFormatKey(registration.settings);
  const slot = version.slots.formatSlots.findIndex(
    (format) => format.summaryKind !== null && format.formatKeyHash === key,
  );
  if (
    slot < 0 ||
    needsFill(version.aggregate, slot, version.slots.formatSlots[slot])
  )
    return undefined;
  const reader = new KeyedMapReader(
    ctx.access,
    ctx.metaCache,
    'meta',
    ctx.hasher,
  );
  const current = await reader.get(
    version.roots.metaRoot,
    `format:last-used:${slot}`,
  );
  if (current === undefined) return undefined;
  for (let index = 0; index < 3; index++) {
    const other = await reader.get(
      version.roots.metaRoot,
      `format:last-used:${index}`,
    );
    if (other !== undefined && decodeDecimal(other) > decodeDecimal(current))
      return undefined;
  }
  return [
    ...registry.filter(
      (item) =>
        item.key !== key &&
        version.slots.formatSlots.some(
          (format) =>
            format.summaryKind !== null && format.formatKeyHash === item.key,
        ),
    ),
    { key, registration },
  ];
}

function replaceSlot<T>(items: Triple<T>, slot: number, value: T): Triple<T> {
  return [
    slot === 0 ? value : items[0],
    slot === 1 ? value : items[1],
    slot === 2 ? value : items[2],
  ];
}

function needsFill(
  aggregate: Aggregate,
  slot: number,
  format: FormatSlot,
): boolean {
  return (
    aggregate.rows > 0 &&
    (aggregate.stamp[slot].gen !== format.gen ||
      aggregate.missingBase[slot] !== 0)
  );
}

async function* missingEntries(
  ctx: BuildContext,
  appender: RecordAppender,
  offset: number,
  slot: number,
  format: FormatSlot,
): AsyncGenerator<RowEntry> {
  const node = await readRowTreeNode(
    ctx.readGroup(appender.nextOffset),
    offset,
  );
  if (node.kind === 'internal') {
    for (const child of node.slots)
      if (needsFill(child.aggregate, slot, format))
        yield* missingEntries(ctx, appender, child.childOffset, slot, format);
  } else {
    for (const entry of node.entries)
      if (entry.stamp[slot].gen !== format.gen || entry.lensRef[slot] === 0)
        yield entry;
  }
}

export function snapshotOf(
  ctx: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
): VersionSnapshot {
  const state = built.state;
  const version = {
    ...genesisVersion(state.nextLabel),
    ...state,
    selfOffset: 0,
    commitSeq: ctx.commitSeq,
    groupTag: 0n,
    roots: {
      rowRoot: state.rowRoot,
      idRoot: state.idRoot,
      metaRoot: state.metaRoot,
      stateRoot: state.stateRoot,
    },
    rows: state.rootAggregate.rows,
    aggregate: state.rootAggregate,
    durableEnd: appender.nextOffset,
  };
  return new VersionSnapshot(
    new PinnedRead(
      version,
      ctx.readGroup(appender.nextOffset),
      new PinLease(() => undefined),
    ),
    ctx.idDeps,
    ctx.idCache,
  );
}

async function measured(
  ctx: BuildContext,
  appender: RecordAppender,
  snapshot: VersionSnapshot,
  entry: RowEntry,
  slot: number,
  format: FormatSlot,
  registration: RowFormatRegistration,
): Promise<RowEntry> {
  const facts = await registration.measure(
    snapshot,
    entry,
    registration.settings,
  );
  if (facts.summary.kind !== format.summaryKind)
    throw new JournalFormatError(
      'Measured summary kind differs from registered format',
    );
  const header = new Uint8Array(32);
  const view = new DataView(header.buffer);
  view.setBigUint64(0, entry.label, true);
  view.setUint32(8, slot, true);
  view.setUint32(12, format.gen, true);
  view.setUint32(16, format.imageGen, true);
  view.setUint32(20, format.formatRev, true);
  view.setBigUint64(24, format.formatKeyHash, true);
  const lensRef = await appender.append({
    kind: RECORD_KIND.LENS,
    kindHeader: header,
    body: { length: facts.lens.length, chunks: [facts.lens] },
  });
  return {
    ...entry,
    lensRef: replaceSlot(entry.lensRef, slot, lensRef),
    summary: replaceSlot(entry.summary, slot, encodeSlotSummary(facts.summary)),
    media: {
      ...entry.media,
      pdfBytes: replaceSlot(entry.media.pdfBytes, slot, facts.pdfBytes ?? 0),
    },
    stamp: replaceSlot(entry.stamp, slot, {
      gen: format.gen,
      imageGen: format.imageGen,
    }),
  };
}

function kindOf(
  registration: RowFormatRegistration,
): 'anthropic' | 'responses' | 'chat' {
  if (registration.settings.formatId === 'anthropic') return 'anthropic';
  if (registration.settings.formatId === 'responses') return 'responses';
  return 'chat';
}

async function assignedSlots(
  ctx: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
  registration: RowFormatRegistration,
): Promise<{ slots: SlotTable; metaRoot: number; slot: number }> {
  const key = rowFormatKey(registration.settings);
  const reader = new KeyedMapReader(
    ctx.readGroup(appender.nextOffset),
    ctx.metaCache,
    'meta',
    ctx.hasher,
  );
  const slots = built.state.slots;
  const reserved = decodeMistralSlots(
    await reader.get(built.state.metaRoot, MISTRAL_SLOTS_KEY),
  );
  let selected = slots.formatSlots.findIndex(
    (format) => format.summaryKind !== null && format.formatKeyHash === key,
  );
  if (selected < 0) {
    let oldest: bigint | undefined;
    for (let index = 0; index < 3; index++) {
      if ((reserved & (1 << index)) !== 0) continue;
      const value = await reader.get(
        built.state.metaRoot,
        `format:last-used:${index}`,
      );
      const used = value === undefined ? 0n : decodeDecimal(value);
      if (oldest === undefined || used < oldest) {
        oldest = used;
        selected = index;
      }
    }
  }
  if (selected < 0)
    throw new JournalFormatError(
      'All format slots are reserved for mapping-only fills',
    );
  const previous = slots.formatSlots[selected];
  const same = previous.summaryKind !== null && previous.formatKeyHash === key;
  if (!same && previous.gen === 0xffff_ffff)
    throw new JournalFormatError('Format generation overflow');
  const format: FormatSlot = same
    ? previous
    : {
        formatKeyHash: key,
        formatRev: registration.settings.formatRev,
        gen: previous.gen + 1,
        imageKeyHash: 0n,
        imageGen: 1,
        summaryKind: kindOf(registration),
      };
  const batch = new KeyedMapBatch(reader, built.state.metaRoot);
  batch.set(`format:last-used:${selected}`, encodeDecimal(ctx.commitSeq));
  return {
    slots: {
      ...slots,
      formatSlots: replaceSlot(slots.formatSlots, selected, format),
    },
    metaRoot: await batch.commit(appender),
    slot: selected,
  };
}

interface SlotFill {
  readonly ctx: BuildContext;
  readonly appender: RecordAppender;
  readonly snapshot: VersionSnapshot;
  readonly slot: number;
  readonly format: FormatSlot;
  readonly registration: RowFormatRegistration;
}

async function measureEntry(
  fill: SlotFill,
  entry: RowEntry,
): Promise<RowEntry> {
  return measured(
    fill.ctx,
    fill.appender,
    fill.snapshot,
    entry,
    fill.slot,
    fill.format,
    fill.registration,
  );
}

async function coldFill(
  fill: SlotFill,
  built: BuiltGroup,
): Promise<BuiltGroup> {
  const { ctx, appender } = fill;
  const root = {
    offset: built.state.rowRoot,
    rows: built.state.rootAggregate.rows,
  };
  async function* entries(): AsyncGenerator<RowEntry> {
    for await (const entry of iterateRowEntries(
      ctx.readGroup(appender.nextOffset),
      root,
    ))
      yield await measureEntry(fill, entry);
  }
  const tree = await bulkBuildRowTree(
    appender,
    rowAlgebra(slotKindsOf(built.state.slots)),
    entries(),
  );
  if (tree === undefined)
    throw new JournalFormatError('Format fill lost live rows');
  return {
    ...built,
    spine: tree.spine,
    state: {
      ...built.state,
      rowRoot: tree.root.childOffset,
      rootAggregate: tree.root.aggregate,
    },
  };
}

async function incrementalFill(
  fill: SlotFill,
  built: BuiltGroup,
): Promise<BuiltGroup> {
  const { ctx, appender, slot, format } = fill;
  let next =
    format.summaryKind === 'responses'
      ? await repairResponsesPairChanges(
          fill,
          built,
          missingEntries(ctx, appender, built.state.rowRoot, slot, format),
        )
      : built;
  const algebra = rowAlgebra(slotKindsOf(built.state.slots));
  for await (const entry of missingEntries(
    ctx,
    appender,
    next.state.rowRoot,
    slot,
    format,
  )) {
    const updated = await measureEntry(fill, entry);
    await appender.drain();
    const root = await editRowTree(
      ctx.readGroup(appender.nextOffset),
      appender,
      algebra,
      { offset: next.state.rowRoot, rows: next.state.rootAggregate.rows },
      { replace: [updated], insert: [] },
    );
    next = {
      ...next,
      spine: undefined,
      state: {
        ...next.state,
        rowRoot: root.childOffset,
        rootAggregate: root.aggregate,
      },
    };
    await appender.drain();
  }
  return next;
}

async function fillSlot(
  fill: SlotFill,
  built: BuiltGroup,
  cold: boolean,
): Promise<BuiltGroup> {
  const { snapshot, registration, ctx, appender, slot } = fill;
  let prepared:
    | Awaited<ReturnType<NonNullable<RowFormatRegistration['prepare']>>>
    | undefined;
  try {
    prepared =
      !cold &&
      registration.prepareAppend !== undefined &&
      ctx.published !== undefined
        ? await registration.prepareAppend(
            snapshot,
            registration.settings,
            ctx.published,
          )
        : await registration.prepare?.(snapshot, registration.settings);
    const nextFill =
      prepared === undefined
        ? fill
        : {
            ...fill,
            registration: { ...registration, measure: prepared.measure },
          };
    let next = built;
    if (built.state.rootAggregate.rows > 0)
      next = cold
        ? await coldFill(nextFill, built)
        : await incrementalFill(nextFill, built);
    return prepared === undefined
      ? next
      : await finishFormatFill(ctx, appender, next, slot, prepared);
  } finally {
    try {
      await prepared?.close();
    } finally {
      await snapshot.close();
    }
  }
}

interface FormatPass {
  readonly ctx: BuildContext;
  readonly appender: RecordAppender;
  readonly registry: readonly RegisteredRowFormat[];
  readonly assigned: number;
  readonly invalidatedAnthropic: boolean;
  readonly activeFactScope: string | undefined;
}

async function fillRegisteredSlot(
  pass: FormatPass,
  built: BuiltGroup,
  slot: number,
): Promise<BuiltGroup> {
  const { ctx, appender, registry, assigned } = pass;
  const format = built.state.slots.formatSlots[slot];
  if (format.summaryKind === null) return built;
  if (pass.invalidatedAnthropic && format.summaryKind === 'anthropic')
    return built;
  if (!needsFill(built.state.rootAggregate, slot, format) && slot !== assigned)
    return built;
  const registration = registry.find(
    (item) => item.key === format.formatKeyHash,
  )?.registration;
  if (registration === undefined && format.summaryKind === 'anthropic')
    return invalidateAnthropicFormats(built, format.formatKeyHash);
  if (registration === undefined)
    throw new JournalFormatError(
      'Active format measurer must be registered before changing history',
    );
  if (
    slot !== assigned &&
    registration.nativeFactScope !== undefined &&
    registration.nativeFactScope !== pass.activeFactScope
  )
    return invalidateAnthropicFormats(built, format.formatKeyHash);
  await appender.drain();
  return fillSlot(
    {
      ctx,
      appender,
      snapshot: snapshotOf(ctx, built, appender),
      slot,
      format,
      registration,
    },
    built,
    slot === assigned,
  );
}

export async function fillRowFormats(
  ctx: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
  edits: readonly VersionEdit[],
  registered: readonly RegisteredRowFormat[],
  invalidatedAnthropic = false,
  activeFactScope?: string,
): Promise<{ built: BuiltGroup; registered: readonly RegisteredRowFormat[] }> {
  let next = built;
  let registry = registered;
  let assigned = -1;
  const edit = edits.find((item) => item.kind === 'format');
  if (edit?.kind === 'format') {
    const registration = captureRowFormat(edit.registration);
    await appender.drain();
    const assignment = await assignedSlots(ctx, next, appender, registration);
    assigned = assignment.slot;
    next = {
      ...next,
      state: {
        ...next.state,
        slots: assignment.slots,
        metaRoot: assignment.metaRoot,
      },
    };
    const key = rowFormatKey(registration.settings);
    registry = [
      ...registry.filter(
        (item) =>
          item.key !== key &&
          assignment.slots.formatSlots.some(
            (slot) =>
              slot.summaryKind !== null && slot.formatKeyHash === item.key,
          ),
      ),
      { key, registration },
    ];
  }
  if (
    assigned < 0 &&
    edits.every((item) =>
      [
        'toolRanking',
        'factIndex',
        'setState',
        'checkpoint',
        'deleteCheckpoint',
      ].includes(item.kind),
    )
  )
    return { built: next, registered: registry };
  const pass = {
    ctx,
    appender,
    registry,
    assigned,
    invalidatedAnthropic,
    activeFactScope,
  };
  for (let slot = 0; slot < 3; slot++)
    next = await fillRegisteredSlot(pass, next, slot);
  return { built: next, registered: registry };
}
