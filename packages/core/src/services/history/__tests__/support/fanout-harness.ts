/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { replaySession } from '../../../../recording/ReplayEngine.js';
import { SessionRecordingService } from '../../../../recording/SessionRecordingService.js';
import type { RecordingWriterIo } from '../../../../recording/types.js';
import { HistoryService } from '../../HistoryService.js';
import type { IContent } from '../../IContent.js';

export const FANOUT_PROJECT_HASH = 'fanout-harness';

export function textRow(
  text: string,
  speaker: 'human' | 'ai' = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

/** The text of a row's text blocks, joined; stable across recording and replay. */
export function rowText(row: IContent): string {
  return row.blocks
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'tool_call') return `<tool_call:${block.id}>`;
      if (block.type === 'tool_response')
        return `<tool_response:${block.callId}>`;
      return `<${block.type}>`;
    })
    .join('|');
}

/** Owns the temp directory, recorders and histories of one fan-out test. */
export class FanoutHarness {
  private dir = '';
  private counter = 0;
  private readonly recorders: SessionRecordingService[] = [];
  private readonly histories: HistoryService[] = [];

  async setup(): Promise<void> {
    this.dir = await mkdtemp(join(tmpdir(), 'fanout-harness-'));
  }

  async teardown(): Promise<void> {
    for (const history of this.histories.splice(0)) await history.dispose();
    for (const recorder of this.recorders.splice(0)) await recorder.dispose();
    await rm(this.dir, { recursive: true, force: true });
  }

  recorder(id: string, io?: RecordingWriterIo): SessionRecordingService {
    const created = new SessionRecordingService({
      sessionId: `harness-${id}-${this.counter++}`,
      projectHash: FANOUT_PROJECT_HASH,
      chatsDir: this.dir,
      workspaceDirs: [this.dir],
      provider: 'test',
      model: 'test',
      ...(io === undefined ? {} : { io }),
    });
    this.recorders.push(created);
    return created;
  }

  history(): HistoryService {
    const created = new HistoryService({ backend: 'old' });
    this.histories.push(created);
    return created;
  }

  /** Two origins attached to one history; A records first, B mirrors. */
  async twoOrigins(): Promise<{
    service: HistoryService;
    ownerA: object;
    ownerB: object;
    a: SessionRecordingService;
    b: SessionRecordingService;
  }> {
    const service = this.history();
    const ownerA = {};
    const ownerB = {};
    const a = this.recorder('a');
    const b = this.recorder('b');
    service.add(textRow('seed'));
    await service.attachJournal(a, true, undefined, ownerA);
    await service.attachJournal(b, true, undefined, ownerB);
    return { service, ownerA, ownerB, a, b };
  }

  /** The history a replay of the recording yields, as row texts. */
  async replayed(recorder: SessionRecordingService): Promise<string[]> {
    return (await this.replayedRows(recorder)).map(rowText);
  }

  /** The rows a replay of the recording yields. */
  async replayedRows(recorder: SessionRecordingService): Promise<IContent[]> {
    await recorder.flush();
    const path = recorder.getFilePath();
    if (path === null) return [];
    const replay = await replaySession(path, recorder.getProjectHash());
    if (!replay.ok) throw new Error(`replay failed: ${replay.error}`);
    if (replay.warnings.length > 0)
      throw new Error(`replay warned: ${replay.warnings.join('; ')}`);
    return replay.history;
  }

  async shared(service: HistoryService): Promise<IContent[]> {
    return collectRawHistory(service);
  }
}
