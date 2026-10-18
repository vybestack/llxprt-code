/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { HistoryService } from '../../../services/history/HistoryService.js';
import { opToEnvelope } from '../../../services/history/historyJournalEnvelope.js';
import { replaceAllOps } from '../../../services/history/historyReplaceOps.js';
import type { IContent } from '../../../services/history/IContent.js';
import { foldDurableRows } from '../../durableRowFold.js';
import { JournalResolver } from '../../journalResolver.js';
import { ResumeCursorBoot } from '../../resumeCursorBoot.js';
import { scanResumeMetadata } from '../../resumeMetadata.js';
import {
  CONTINUE_LATEST,
  resumeJsonlSession,
  type JsonlResumeResult as ResumeResult,
} from '../../resumeSession.js';
import { SessionRecordingService } from '../../SessionRecordingService.js';

export const PROJECT_HASH = 'crashed-replace-project';
const PROVIDER = 'openai';
const MODEL = 'gpt-4.1';

export function newRecorder(dir: string): SessionRecordingService {
  return new SessionRecordingService({
    sessionId: 'crashed-replace',
    projectHash: PROJECT_HASH,
    chatsDir: dir,
    workspaceDirs: [dir],
    provider: PROVIDER,
    model: MODEL,
  });
}

export interface InterruptedReplaceOptions {
  readonly taggedRows: readonly string[];
  readonly commit?: boolean;
  /** A plain row written after the tagged rows, abandoning the transaction. */
  readonly abandonedBy?: string;
}

/**
 * Record what a process leaves behind when it stops inside a replacement: one
 * prior row, then `replace_begin` and `taggedRows` rows tagged with the
 * transaction. `commit` finishes the transaction instead, as a clean shutdown
 * would.
 */
export async function recordInterruptedReplace(
  recorder: SessionRecordingService,
  options: InterruptedReplaceOptions,
): Promise<void> {
  await recorder.commit('content', { content: row('old', 1) });
  await recorder.commit('replace_begin', { txId: 'crashed' });
  let seq = 2;
  for (const text of options.taggedRows)
    await recorder.commit('content', {
      content: row(text, seq++),
      tx: 'crashed',
    });
  if (options.commit === true)
    await recorder.commit('replace_commit', {
      txId: 'crashed',
      rowCount: options.taggedRows.length,
    });
  if (options.abandonedBy !== undefined)
    await recorder.commit('content', {
      content: row(options.abandonedBy, seq),
    });
}

export function row(text: string, seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

export function textOf(content: IContent): string {
  const block = content.blocks[0];
  if (block.type !== 'text') throw new Error('expected a text block');
  return block.text;
}

/** One session directory plus everything that must be released with it. */
export class CrashedReplaceSession {
  private readonly releases: Array<() => Promise<void>> = [];

  private constructor(
    readonly dir: string,
    readonly filePath: string,
  ) {}

  /**
   * A journal whose process stopped inside a replacement: one prior row, then
   * `replace_begin` and `taggedRows` rows tagged with the transaction.
   * `commit` finishes the transaction instead, as a clean shutdown would.
   */
  static async create(
    options: InterruptedReplaceOptions,
  ): Promise<CrashedReplaceSession> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crashed-replace-'));
    const recorder = newRecorder(dir);
    try {
      await recordInterruptedReplace(recorder, options);
      const filePath = recorder.getFilePath();
      if (filePath === null) throw new Error('journal was not materialized');
      return new CrashedReplaceSession(dir, filePath);
    } finally {
      await recorder.dispose();
    }
  }

  /** Resume the session as `--continue` does, owning the result until `close`. */
  async resume(model = MODEL): Promise<ResumeResult> {
    const resumed = await resumeJsonlSession({
      continueRef: CONTINUE_LATEST,
      projectHash: PROJECT_HASH,
      chatsDir: this.dir,
      currentProvider: PROVIDER,
      currentModel: model,
      workspaceDirs: [this.dir],
    });
    if (!resumed.ok) throw new Error(resumed.error);
    this.releases.push(
      () => resumed.recording.dispose(),
      () => resumed.boot.close(),
    );
    return resumed;
  }

  /** Resume, adopt the journal into a history service, and return it. */
  async resumeHistory(model = MODEL): Promise<{
    readonly resumed: ResumeResult;
    readonly history: HistoryService;
  }> {
    const resumed = await this.resume(model);
    const history = new HistoryService();
    this.releases.push(() => history.dispose());
    await history.adoptResumeBoot(resumed.recording, resumed.boot);
    return { resumed, history };
  }

  /** Stop the process: flush and release every resumed recorder and lock. */
  async stop(): Promise<void> {
    for (
      let release = this.releases.pop();
      release;
      release = this.releases.pop()
    )
      await release();
  }

  async cleanup(): Promise<void> {
    await this.stop();
    await fs.rm(this.dir, { recursive: true, force: true });
  }

  /** Record types in file order. */
  async recordTypes(): Promise<string[]> {
    return (await this.records()).map((record) => record.type);
  }

  async records(): Promise<Array<{ type: string; payload: unknown }>> {
    const text = await fs.readFile(this.filePath, 'utf8');
    return text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { type: string; payload: unknown });
  }

  /** Rows as each journal reader folds the file; they must all agree. */
  async readEveryWay(): Promise<Record<string, string[]>> {
    return {
      resolver: await viaResolver(this.filePath),
      durableFold: await viaDurableFold(this.filePath),
      resumeFold: await this.viaResumeFold(),
    };
  }

  private async viaResumeFold(): Promise<string[]> {
    const resumed = await this.resume();
    const boot: ResumeCursorBoot = resumed.boot;
    const rows: string[] = [];
    for await (const content of boot.streamRows()) rows.push(textOf(content));
    await this.stop();
    return rows;
  }
}

export async function viaResolver(file: string): Promise<string[]> {
  const resolver = await JournalResolver.open(file);
  const rows: string[] = [];
  try {
    for await (const entry of resolver.resolve())
      rows.push(textOf(entry.content));
  } finally {
    await resolver.close();
  }
  return rows;
}

export async function viaDurableFold(file: string): Promise<string[]> {
  const fold = await foldDurableRows({
    filePath: file,
    maxBytes: (await fs.stat(file)).size,
  });
  const rows: string[] = [];
  try {
    for (let index = 0; index < fold.length; index += 1)
      rows.push(textOf(await fold.readRow(index)));
  } finally {
    await fold.close();
  }
  return rows;
}

/** The rows a resume would stream from a journal file that is not a session file. */
export async function viaBootStream(file: string): Promise<string[]> {
  const { replay, watermark } = await scanResumeMetadata(
    file,
    PROJECT_HASH,
    (await fs.stat(file)).size,
  );
  if (!replay.ok) throw new Error(replay.error);
  const boot = await ResumeCursorBoot.open(file, replay.lastSeq, watermark);
  const rows: string[] = [];
  try {
    for await (const content of boot.streamRows()) rows.push(textOf(content));
  } finally {
    await boot.close();
  }
  return rows;
}

/** Record types of a journal file, in file order. */
export async function recordTypesOf(file: string): Promise<string[]> {
  const text = await fs.readFile(file, 'utf8');
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => (JSON.parse(line) as { type: string }).type);
}

/** Commit a replacement of the whole history through `recorder`, as the history service does. */
export async function commitReplacement(
  recorder: SessionRecordingService,
  texts: readonly string[],
): Promise<void> {
  const rows = texts.map((text, index) => row(text, index + 100));
  for (const op of replaceAllOps(rows)) {
    const event = opToEnvelope(op);
    await recorder.commit(event.type, event.payload);
  }
}

/** Every reader returning `expected`. */
export function allReadersSee(
  expected: readonly string[],
): Record<string, string[]> {
  return {
    resolver: [...expected],
    durableFold: [...expected],
    resumeFold: [...expected],
  };
}
