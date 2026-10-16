/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { EMPTY_AGGREGATE, type SlotKinds } from '../../aggregateComposition.js';
import type {
  CommitAck,
  GroupRecord,
  TrailerState,
} from '../../groupWriter.js';
import {
  openJournalReadOnly,
  type JournalReader,
} from '../../journalReader.js';
import {
  createJournal,
  openJournalForOwner,
  type JournalOpenDependencies,
} from '../../journalWriterOpen.js';
import type { JournalGroupWriter } from '../../groupWriter.js';
import { createRecordAccess } from '../../recordAccess.js';
import type { RowEntry } from '../../rowEntry.js';
import { editRowTree, type RowTreeEdits } from '../../rowTreeEdit.js';
import {
  appendRowEntries,
  bulkBuildRowTree,
  type RightSpine,
  type RowTreeState,
} from '../../rowTreeBuilder.js';
import {
  loadRightSpine,
  rowTreeRootOf,
  type RowTreeRootRef,
} from '../../rowTreeReader.js';
import { testAlgebra } from './rowTreeFixtures.js';
import { trailerStateFor, testJournalSeams } from './journalFixtures.js';

/** The trailer state of a group that leaves the row tree in `state`. */
export function treeTrailerState(
  seed: number,
  state: Pick<RowTreeState, 'root'> | undefined,
  kinds: SlotKinds,
): TrailerState {
  const base = trailerStateFor(seed, {});
  const [first, second, third] = base.slots.formatSlots;
  return {
    ...base,
    rowRoot: state?.root.childOffset ?? 0,
    rootAggregate: state?.root.aggregate ?? EMPTY_AGGREGATE,
    slots: {
      ...base.slots,
      formatSlots: [
        { ...first, summaryKind: kinds[0] },
        { ...second, summaryKind: kinds[1] },
        { ...third, summaryKind: kinds[2] },
      ],
    },
  };
}

/** A journal that only ever holds a row tree, with the writer's right spine kept in memory. */
export class TreeFixtureWriter {
  private groups = 0;

  constructor(
    readonly writer: JournalGroupWriter,
    private readonly kinds: SlotKinds,
    private spine: RightSpine | undefined,
    private readonly file: string,
  ) {}

  /** Applies label-keyed edits to the committed tree by path copying, as one group. */
  async editRows(edits: RowTreeEdits): Promise<CommitAck> {
    const seed = ++this.groups;
    const published = this.writer.published;
    const root = rowTreeRootOf(published?.trailer);
    if (published === undefined || root === undefined) {
      throw new Error('There is no committed tree to edit');
    }
    const access = createRecordAccess(
      this.file,
      this.writer.reader,
      published.trailer,
    );
    const ack = await this.writer.commitStreamedGroup(async (appender) => {
      const edited = await editRowTree(
        access,
        appender,
        testAlgebra(this.kinds),
        root,
        edits,
      );
      return treeTrailerState(seed, { root: edited }, this.kinds);
    });
    // The edit keeps no spine; the next append needs the one the file now holds.
    const after = this.writer.published;
    const newRoot = rowTreeRootOf(after?.trailer);
    if (after === undefined || newRoot === undefined) {
      throw new Error('The edit left no committed tree');
    }
    this.spine = await loadRightSpine(
      createRecordAccess(this.file, this.writer.reader, after.trailer),
      newRoot,
    );
    return ack;
  }

  /**
   * Appends the entries as one group, path-copying the right spine. The
   * `before` records are written first in the same group, standing in for the
   * records a real append writes besides the tree (the row, the id nodes).
   */
  appendRows(
    entries: readonly RowEntry[],
    before: readonly GroupRecord[] = [],
  ): Promise<CommitAck> {
    return this.commit(async (appender, algebra, spine) => {
      for (const record of before) await appender.append(record);
      return appendRowEntries(appender, algebra, spine, entries);
    });
  }

  /** Builds the whole tree from a stream of entries as one group. */
  bulkBuild(
    entries: Iterable<RowEntry> | AsyncIterable<RowEntry>,
  ): Promise<CommitAck> {
    return this.commit((appender, algebra) =>
      bulkBuildRowTree(appender, algebra, entries),
    );
  }

  private commit(
    build: (
      ...args: [
        Parameters<Parameters<JournalGroupWriter['commitStreamedGroup']>[0]>[0],
        ReturnType<typeof testAlgebra>,
        RightSpine | undefined,
      ]
    ) => Promise<RowTreeState | undefined>,
  ): Promise<CommitAck> {
    const seed = ++this.groups;
    let next: RowTreeState | undefined;
    const ack = this.writer.commitStreamedGroup(async (appender) => {
      next = await build(appender, testAlgebra(this.kinds), this.spine);
      return treeTrailerState(seed, next, this.kinds);
    });
    return ack.then((result) => {
      this.spine = next?.spine;
      return result;
    });
  }

  close(): Promise<void> {
    return this.writer.close();
  }
}

export async function createTreeWriter(
  file: string,
  kinds: SlotKinds,
  dependencies: JournalOpenDependencies = testJournalSeams().dependencies,
): Promise<TreeFixtureWriter> {
  return new TreeFixtureWriter(
    await createJournal(file, dependencies),
    kinds,
    undefined,
    file,
  );
}

/** Reopens the journal for its owner and rebuilds the right spine from the file. */
export async function reopenTreeWriter(
  file: string,
  kinds: SlotKinds,
  dependencies: JournalOpenDependencies = testJournalSeams().dependencies,
): Promise<TreeFixtureWriter> {
  const reader = await openJournalReadOnly(file, dependencies);
  try {
    const root = rowTreeRootOf(reader.trailer);
    const spine =
      root === undefined ? undefined : await loadRightSpine(reader, root);
    const { writer } = await openJournalForOwner(file, dependencies);
    return new TreeFixtureWriter(writer, kinds, spine, file);
  } finally {
    await reader.close();
  }
}

export interface OpenedTree {
  readonly reader: JournalReader;
  readonly root: RowTreeRootRef | undefined;
}

export async function openTree(
  file: string,
  dependencies: JournalOpenDependencies = testJournalSeams().dependencies,
): Promise<OpenedTree> {
  const reader = await openJournalReadOnly(file, dependencies);
  return { reader, root: rowTreeRootOf(reader.trailer) };
}
