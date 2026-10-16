/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import { buildGroup, mapReader, type BuildContext } from './groupBuild.js';
import type { OccurrencePlanner, VersionEdit } from './groupEdits.js';
import { mutationOf, planGroup, type PlanContext } from './groupPlan.js';
import type { CommitAck } from './groupWriter.js';
import type { JournalGroupWriter } from './groupWriter.js';
import { IdFactQueries, type IdFactDeps } from './idFactQueries.js';
import { BoundedIdNodeCache, type IdNodeCache } from './idTrieCache.js';
import { IdTrieReader } from './idTrieReader.js';
import {
  createJournal,
  openJournalForOwner,
  type JournalOpenDependencies,
} from './journalWriterOpen.js';
import { FIRST_NEXT_LABEL } from './labels.js';
import { LineageChain, loadChain } from './lineageChain.js';
import { createRecordAccess, type RecordAccess } from './recordAccess.js';
import type { RowEntry } from './rowEntry.js';
import type { RightSpine, RowTreeAlgebra } from './rowTreeBuilder.js';
import {
  iterateRowEntries,
  loadRightSpine,
  type RowTreeRootRef,
} from './rowTreeReader.js';
import { readVersionAt } from './trailerAccess.js';
import { versionOf, type Version } from './version.js';
import type { SlotKinds } from './aggregateComposition.js';

/** What the store is built from: the file seams, the hash, the two normalizers and the planner. */
export interface JournalStoreDependencies {
  readonly journal: JournalOpenDependencies;
  readonly idDeps: IdFactDeps;
  readonly planOccurrences: OccurrencePlanner;
  /** The aggregate algebra of the row tree for a slot table. */
  readonly algebra: (kinds: SlotKinds) => RowTreeAlgebra;
  /** One capped cache each for the id trie, the meta map and the state map. */
  readonly createCache?: () => IdNodeCache;
}

function noop(): void {
  // Settles the tail of the commit queue; the caller sees the commit's own outcome.
}

interface SpineEntry {
  readonly rowRoot: number;
  readonly spine: RightSpine;
}

/**
 * One journal as a versioned store: the single writer of the file, the
 * published version, and the maps and facts that version names. Edits are
 * applied to a tentative version that exists only inside a commit group; the
 * published version moves in one place, after the group's trailer is acked
 * (design 4.1), so a version is never readable before it is durable.
 */
export class JournalStore {
  private currentVersion: Version | undefined;
  private access: RecordAccess | undefined;
  private chain: LineageChain | undefined;
  private spineEntry: SpineEntry | undefined;
  private tail: Promise<void> = Promise.resolve();
  private readonly idCache: IdNodeCache;
  private readonly metaCache: IdNodeCache;
  private readonly stateCache: IdNodeCache;

  private constructor(
    readonly path: string,
    private readonly writer: JournalGroupWriter,
    private readonly deps: JournalStoreDependencies,
  ) {
    const make =
      deps.createCache ?? ((): IdNodeCache => new BoundedIdNodeCache());
    this.idCache = make();
    this.metaCache = make();
    this.stateCache = make();
    this.install(writer.published?.trailer);
  }

  static async create(
    path: string,
    deps: JournalStoreDependencies,
  ): Promise<JournalStore> {
    return new JournalStore(
      path,
      await createJournal(path, deps.journal),
      deps,
    );
  }

  /** Opens an existing journal for its owner; the last committed version is the published one. */
  static async open(
    path: string,
    deps: JournalStoreDependencies,
  ): Promise<JournalStore> {
    const { writer } = await openJournalForOwner(path, deps.journal);
    return new JournalStore(path, writer, deps);
  }

  /** The last version whose trailer was acked, or undefined before the first group. */
  get published(): Version | undefined {
    return this.currentVersion;
  }

  /**
   * Applies the edits in order to a tentative version and commits it as one
   * group. Groups run one at a time in the order they are submitted.
   */
  commit(edits: readonly VersionEdit[]): Promise<CommitAck> {
    const turn = this.tail.then(() => this.runCommit(edits));
    this.tail = turn.then(noop, noop);
    return turn;
  }

  async close(): Promise<void> {
    await this.tail;
    await this.writer.close();
  }

  /** A meta map entry of the published version. */
  async getMeta(key: string): Promise<Uint8Array | undefined> {
    return mapReader(this.readContext(), 'meta').get(
      this.currentVersion?.roots.metaRoot ?? 0,
      key,
    );
  }

  /** A state map entry of the published version. */
  async getState(key: string): Promise<Uint8Array | undefined> {
    return mapReader(this.readContext(), 'state').get(
      this.currentVersion?.roots.stateRoot ?? 0,
      key,
    );
  }

  /** Id facts of the published version. */
  idFacts(): IdFactQueries {
    const root = this.currentVersion?.roots.idRoot ?? 0;
    const reader =
      this.access === undefined
        ? undefined
        : new IdTrieReader(this.access, this.idCache);
    return new IdFactQueries(
      {
        get: async (hash) =>
          reader === undefined ? undefined : reader.lookup(root, hash),
      },
      this.deps.idDeps,
    );
  }

  /** The live rows of the published version, in label order. */
  async *rows(from = 0): AsyncGenerator<RowEntry> {
    const root = this.rowRootRef();
    if (root === undefined || this.access === undefined) return;
    yield* iterateRowEntries(this.access, root, from);
  }

  /** The version a trailer at `offset` carries. */
  readVersion(offset: number): Promise<Version> {
    return readVersionAt(this.requireAccess(), offset);
  }

  private async runCommit(edits: readonly VersionEdit[]): Promise<CommitAck> {
    const mutation = mutationOf(edits);
    const plan = await planGroup(this.planContext(), edits);
    let built: Awaited<ReturnType<typeof buildGroup>> | undefined;
    const ack = await this.writer.commitStreamedGroup(async (appender) => {
      built = await buildGroup(this.buildContext(), plan, mutation, appender);
      return built.state;
    });
    const trailer = this.writer.published?.trailer;
    if (built === undefined || trailer === undefined) {
      throw new JournalFormatError('A committed group left no trailer');
    }
    this.install(trailer);
    this.chain = built.chainBase.push(trailer.selfOffset);
    if (built.spine !== undefined) {
      this.spineEntry = { rowRoot: trailer.rowRoot, spine: built.spine };
    }
    return ack;
  }

  /** The only place the published version moves. */
  private install(trailer: Parameters<typeof versionOf>[0] | undefined): void {
    if (trailer === undefined) return;
    this.currentVersion = versionOf(trailer);
    this.access = createRecordAccess(this.path, this.writer.reader, trailer);
  }

  private requireAccess(): RecordAccess {
    if (this.access === undefined) {
      throw new JournalFormatError('The journal has no committed group');
    }
    return this.access;
  }

  private rowRootRef(): RowTreeRootRef | undefined {
    const version = this.currentVersion;
    return version === undefined || version.roots.rowRoot === 0
      ? undefined
      : { offset: version.roots.rowRoot, rows: version.rows };
  }

  private planContext(): PlanContext {
    return {
      access: this.access,
      published: this.currentVersion,
      readVersion: (offset) => this.readVersion(offset),
      firstNextLabel: FIRST_NEXT_LABEL,
    };
  }

  private readContext(): BuildContext {
    return this.buildContext();
  }

  private buildContext(): BuildContext {
    return {
      access: this.access,
      published: this.currentVersion,
      hasher: this.deps.idDeps.hasher,
      idDeps: this.deps.idDeps,
      planOccurrences: this.deps.planOccurrences,
      idCache: this.idCache,
      metaCache: this.metaCache,
      stateCache: this.stateCache,
      algebra: this.deps.algebra,
      spineFor: (version) => this.spineFor(version),
      chainFor: (parent) => this.chainFor(parent),
      commitSeq: (this.currentVersion?.commitSeq ?? 0) + 1,
    };
  }

  private async spineFor(version: Version): Promise<RightSpine> {
    if (this.spineEntry?.rowRoot === version.roots.rowRoot) {
      return this.spineEntry.spine;
    }
    const spine = await loadRightSpine(this.requireAccess(), {
      offset: version.roots.rowRoot,
      rows: version.rows,
    });
    this.spineEntry = { rowRoot: version.roots.rowRoot, spine };
    return spine;
  }

  private async chainFor(parent: Version | undefined): Promise<LineageChain> {
    if (parent === undefined) return LineageChain.NONE;
    const held = this.chain?.truncatedTo(parent.lineageDepth);
    if (held?.offsetAtDepth(parent.lineageDepth) === parent.selfOffset) {
      return held;
    }
    return loadChain((offset) => this.readVersion(offset), parent);
  }
}
