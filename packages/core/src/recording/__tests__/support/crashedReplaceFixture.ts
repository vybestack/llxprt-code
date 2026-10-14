/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { HistoryService } from '../../../services/history/HistoryService.js';
import type { IContent } from '../../../services/history/IContent.js';
import { foldDurableRows } from '../../durableRowFold.js';
import { JournalResolver } from '../../journalResolver.js';
import type { ResumeCursorBoot } from '../../resumeCursorBoot.js';
import {
  CONTINUE_LATEST,
  resumeSession,
  type ResumeResult,
} from '../../resumeSession.js';
import { SessionRecordingService } from '../../SessionRecordingService.js';

const PROJECT_HASH = 'crashed-replace-project';
const PROVIDER = 'openai';
const MODEL = 'gpt-4.1';

export function row(text: string, seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

function textOf(content: IContent): string {
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
  static async create(options: {
    readonly taggedRows: readonly string[];
    readonly commit?: boolean;
    /** A plain row written after the tagged rows, abandoning the transaction. */
    readonly abandonedBy?: string;
  }): Promise<CrashedReplaceSession> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crashed-replace-'));
    const recorder = new SessionRecordingService({
      sessionId: 'crashed-replace',
      projectHash: PROJECT_HASH,
      chatsDir: dir,
      workspaceDirs: [dir],
      provider: PROVIDER,
      model: MODEL,
    });
    try {
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
      const filePath = recorder.getFilePath();
      if (filePath === null) throw new Error('journal was not materialized');
      return new CrashedReplaceSession(dir, filePath);
    } finally {
      await recorder.dispose();
    }
  }

  /** Resume the session as `--continue` does, owning the result until `close`. */
  async resume(model = MODEL): Promise<ResumeResult> {
    const resumed = await resumeSession({
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

async function viaResolver(file: string): Promise<string[]> {
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

async function viaDurableFold(file: string): Promise<string[]> {
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
