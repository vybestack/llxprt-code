/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  normalizeToAnthropicToolId,
  normalizeToOpenAIToolId,
} from '@vybestack/llxprt-code-tools';
import type { OccurrencePlanner } from '../../journal/groupEdits.js';
import type { CommitAck } from '../../journal/groupWriter.js';
import { sha256KeyHash } from '../../journal/idKeys.js';
import { JournalStore } from '../../journal/journalStore.js';
import type { JournalStoreDependencies } from '../../journal/journalStore.js';
import {
  resolveJournalDependencies,
  type JournalOpenDependencies,
} from '../../journal/journalWriterOpen.js';
import { planOwnRowOccurrences } from '../../journal/ownRowPlanner.js';
import { rowAlgebra } from '../../journal/rowAlgebra.js';
import { openUnlinkedFile } from '../../journal/unlinkedFile.js';
import {
  decodeStoredRow,
  encodeContentRow,
  UNOWNED_ROW,
} from './journalRowCodec.js';
import type { IContent } from './IContent.js';
import type { RowEntry } from '../../journal/rowEntry.js';

/** What a caller may replace: the file seams (tests) and the occurrence planner (the normalizer of phase 5). */
export interface JournalSessionOptions {
  readonly journal?: Partial<JournalOpenDependencies>;
  readonly planOccurrences?: OccurrencePlanner;
  /** Where the bare store's nameless file is created; the system temp directory by default. */
  readonly unlinkedDirectory?: string;
}

async function storeDependencies(
  options: JournalSessionOptions,
): Promise<JournalStoreDependencies> {
  return {
    journal: await resolveJournalDependencies(options.journal),
    idDeps: {
      hasher: sha256KeyHash,
      normalizers: {
        openai: normalizeToOpenAIToolId,
        anthropic: normalizeToAnthropicToolId,
      },
    },
    planOccurrences: options.planOccurrences ?? planOwnRowOccurrences,
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
    return new JournalSession(
      await JournalStore.open(path, await storeDependencies(options)),
      true,
    );
  }

  /**
   * The bare store: a journal in a file with no name (design 4.12), which
   * disappears when it is closed. Nothing is left in any directory.
   */
  static async createUnlinked(
    options: JournalSessionOptions = {},
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
    return new JournalSession(
      await JournalStore.create('(unlinked journal)', deps),
      false,
    );
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
