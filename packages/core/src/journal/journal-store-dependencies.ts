/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalMaintenanceScope } from './deferred-maintenance.js';
import type { JournalOpenDependencies } from './journalWriterOpen.js';
import type { IdFactDeps } from './idFactQueries.js';
import type { OccurrencePlanner } from './groupEdits.js';
import type { RecencyFactPolicy } from './recencyFacts.js';
import type { ContextSpanPolicy } from './contextSpanFacts.js';
import type { NeutralRowFactRegistration } from './neutralRowFacts.js';
import type { SlotKinds } from './aggregateComposition.js';
import type { RowTreeAlgebra } from './rowTreeBuilder.js';
import type { IdNodeCache } from './idTrieCache.js';
import type { FileOperations } from './compactionSwap.js';
import type { Version } from './version.js';

/** What the store is built from: the file seams, the hash, the two normalizers and the planner. */
export interface JournalStoreDependencies {
  readonly maintenanceScope?: JournalMaintenanceScope;
  readonly journal: JournalOpenDependencies;
  readonly idDeps: IdFactDeps;
  readonly planOccurrences: OccurrencePlanner;
  readonly recencyFactPolicy?: RecencyFactPolicy;
  readonly contextSpanPolicy?: ContextSpanPolicy;
  readonly neutralRowFacts?: NeutralRowFactRegistration;
  readonly eagerNeutralRowFacts?: boolean;
  /** The aggregate algebra of the row tree for a slot table. */
  readonly algebra: (kinds: SlotKinds) => RowTreeAlgebra;
  /** One capped cache each for the id trie, the meta map and the state map. */
  readonly createCache?: () => IdNodeCache;
  /** The rename, close and open of the compaction swap (design 4.11); the real ones by default. */
  readonly fileOperations?: FileOperations;
  /** Whether the file has outgrown its version (design 4.11); a test lowers the floor through it. */
  readonly compactionDue?: (version: Version, notBefore: number) => boolean;
}
