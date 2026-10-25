/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { NEUTRAL_ROW_FACTS_THROUGH } from '../../journal/neutralRowFacts.js';
import { tokenUsageFactRegistration } from './token-usage-facts.js';
import { estimateTokens } from '../../utils/toolOutputLimiter.js';
import { journalContextSpan } from './journalContextSpan.js';
import { RECENCY_INDEX_READY } from '../../journal/recencyFacts.js';
import { densityRecencyFactPolicy } from './densityRecencyFacts.js';
import {
  generateDeterministicMistralId,
  normalizeToAnthropicToolId,
  normalizeToOpenAIToolId,
} from '@vybestack/llxprt-code-tools';
import type { OccurrencePlanner } from '../../journal/groupEdits.js';
import { CHRONOLOGY_INDEX_READY } from '../../journal/chronologyFacts.js';
import { DENSITY_CALL_INDEX_READY } from '../../journal/densityCallFacts.js';
import type { CommitAck } from '../../journal/groupWriter.js';
import { sha256KeyHash } from '../../journal/idKeys.js';
import { JournalStore } from '../../journal/journalStore.js';
import type { JournalStoreDependencies } from '../../journal/journalStore.js';
import {
  resolveJournalDependencies,
  type JournalOpenDependencies,
} from '../../journal/journalWriterOpen.js';
import { planSourceRowOccurrences } from './source-fact-planner.js';
import { rowAlgebra } from '../../journal/rowAlgebra.js';
import { openUnlinkedFile } from '../../journal/unlinkedFile.js';
import { openSynchronousUnlinkedFile } from '../../journal/synchronous-unlinked-file.js';
import { loadSynchronousFlushRecords } from '../../journal/flushRecords.js';
import { randomBytes } from 'node:crypto';
import {
  decodeStoredRow,
  encodeContentRow,
  UNOWNED_ROW,
} from './journalRowCodec.js';
import type { IContent } from './IContent.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import {
  captureRowFormat,
  type RowFormatRegistration,
} from '../../journal/rowFormat.js';

/** What a caller may replace: the file seams (tests) and the occurrence planner (the normalizer of phase 5). */
export interface JournalSessionOptions {
  readonly journal?: Partial<JournalOpenDependencies>;
  readonly tokenUsageCountTokens?: (text: string) => number;
  readonly eagerTokenUsageFacts?: boolean;
  readonly planOccurrences?: OccurrencePlanner;
  /** Where the bare store's nameless file is created; the system temp directory by default. */
  readonly unlinkedDirectory?: string;
}

async function storeDependencies(
  options: JournalSessionOptions,
): Promise<JournalStoreDependencies> {
  return dependenciesWithJournal(
    options,
    await resolveJournalDependencies(options.journal),
  );
}

function dependenciesWithJournal(
  options: JournalSessionOptions,
  journal: JournalOpenDependencies,
): JournalStoreDependencies {
  return {
    journal,
    idDeps: {
      hasher: sha256KeyHash,
      occurrenceSpace: 'source-with-normalized',
      mistralCandidate: generateDeterministicMistralId,
      normalizers: {
        openai: normalizeToOpenAIToolId,
        anthropic: normalizeToAnthropicToolId,
      },
    },
    planOccurrences: options.planOccurrences ?? planSourceRowOccurrences,
    recencyFactPolicy: densityRecencyFactPolicy,
    contextSpanPolicy: journalContextSpan,
    eagerNeutralRowFacts: options.eagerTokenUsageFacts,
    neutralRowFacts: tokenUsageFactRegistration(
      options.tokenUsageCountTokens ?? estimateTokens,
    ),
    algebra: rowAlgebra,
  };
}

/** A history entry and the index entry of the row that holds it. */
export interface SessionRow {
  readonly entry: RowEntry;
  readonly content: IContent;
}

export interface AppendOptions {
  readonly owner?: number;
  readonly invalidateResponses?: boolean;
}

/**
 * One journal seen in terms of history entries: the store, with the row codec
 * on its write and read sides. A row is converted one at a time in both
 * directions, so what is held is the conversion of one row.
 */
export class JournalSession {
  private constructor(
    readonly store: JournalStore,
    /** False for the bare store, whose file has no name to read it by. */
    readonly named: boolean,
  ) {}

  /** A new journal file at `path`. */
  static async create(
    path: string,
    options: JournalSessionOptions = {},
  ): Promise<JournalSession> {
    return new JournalSession(
      await JournalStore.create(path, await storeDependencies(options)),
      true,
    );
  }

  /** An existing journal file, opened for its owner. */
  static async open(
    path: string,
    options: JournalSessionOptions = {},
  ): Promise<JournalSession> {
    const store = await JournalStore.open(
      path,
      await storeDependencies(options),
    );
    try {
      if (
        (store.published?.rows ?? 0) > 0 &&
        (await store.getMeta(CHRONOLOGY_INDEX_READY)) === undefined
      )
        await store.commit([{ kind: 'chronology' }]);
      if (
        (store.published?.rows ?? 0) > 0 &&
        (await store.getMeta(DENSITY_CALL_INDEX_READY)) === undefined
      )
        await store.commit([{ kind: 'densityCalls' }]);
      if (
        (store.published?.rows ?? 0) > 0 &&
        new TextDecoder().decode(await store.getMeta(RECENCY_INDEX_READY)) !==
          densityRecencyFactPolicy.revision
      )
        await store.commit([{ kind: 'recency' }]);
      if (
        options.eagerTokenUsageFacts === true &&
        new TextDecoder().decode(
          await store.getMeta(NEUTRAL_ROW_FACTS_THROUGH),
        ) !== String(store.published?.commitSeq)
      )
        await store.commit([{ kind: 'append', rows: [] }]);
      return new JournalSession(store, true);
    } catch (error) {
      await store.close();
      throw error;
    }
  }

  /**
   * The bare store: a journal in a file with no name (design 4.12), which
   * disappears when it is closed. Nothing is left in any directory.
   */
  static createUnlinked(
    options: JournalSessionOptions = {},
  ): JournalSession | Promise<JournalSession> {
    return options.journal === undefined
      ? JournalSession.createSynchronousUnlinked(options)
      : JournalSession.createAsynchronousUnlinked(options);
  }

  private static async createAsynchronousUnlinked(
    options: JournalSessionOptions,
  ): Promise<JournalSession> {
    const deps = await storeDependencies({
      ...options,
      journal: {
        ...options.journal,
        open: () =>
          openUnlinkedFile(
            options.unlinkedDirectory === undefined
              ? {}
              : { directory: options.unlinkedDirectory },
          ),
      },
    });
    return new JournalSession(await JournalStore.createUnlinked(deps), false);
  }

  private static createSynchronousUnlinked(
    options: JournalSessionOptions,
  ): JournalSession {
    const deps = dependenciesWithJournal(options, {
      open: () =>
        openUnlinkedFile(
          options.unlinkedDirectory === undefined
            ? {}
            : { directory: options.unlinkedDirectory },
        ),
      flush: loadSynchronousFlushRecords(),
      nowMs: Date.now,
      random: (length) => randomBytes(length),
    });
    return new JournalSession(
      JournalStore.createSynchronousUnlinked(
        openSynchronousUnlinkedFile(options.unlinkedDirectory),
        deps,
      ),
      false,
    );
  }

  /**
   * A bare store holding the published version of this journal, in a file of
   * its own (design 4.8); this journal is left as it is.
   */
  async cloneUnlinked(
    options: Pick<JournalSessionOptions, 'unlinkedDirectory'> = {},
  ): Promise<JournalSession> {
    const store = await this.store.cloneUnlinked(() =>
      openUnlinkedFile(
        options.unlinkedDirectory === undefined
          ? {}
          : { directory: options.unlinkedDirectory },
      ),
    );
    return new JournalSession(store, false);
  }

  get path(): string {
    return this.store.path;
  }

  /** Appends the entries as one commit group, in order. */
  append(
    contents: readonly IContent[],
    options: AppendOptions = {},
  ): Promise<CommitAck> {
    const rows = contents.map((content) =>
      encodeContentRow(content, {
        owner: options.owner ?? UNOWNED_ROW,
        invalidateResponses: options.invalidateResponses,
      }),
    );
    return this.store.commit([{ kind: 'append', rows }]);
  }

  async registerRowFormat(registration: RowFormatRegistration): Promise<void> {
    await this.store.commit([
      { kind: 'format', registration: captureRowFormat(registration) },
    ]);
  }

  /** The entry a row holds. */
  async readContent(entry: RowEntry): Promise<IContent> {
    return decodeStoredRow(await this.store.readRow(entry));
  }

  /** The live rows of the published version with their entries, one row in memory at a time. */
  async *rows(from = 0): AsyncGenerator<SessionRow> {
    for await (const entry of this.store.rows(from)) {
      yield { entry, content: await this.readContent(entry) };
    }
  }

  close(): Promise<void> {
    return this.store.close();
  }
}
