/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { openJournalReadOnly } from '../../../journal/journalReader.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '../../../journal/rowTreeReader.js';
import { readStoredRow } from '../../../journal/rowReads.js';
import {
  testJournalSeams,
  type Failures,
  type TestJournalSeams,
} from '../../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../journal/__tests__/support/useTempDir.js';
import { HistoryService } from '../../../services/history/HistoryService.js';
import { decodeStoredRow } from '../../../services/history/journalRowCodec.js';
import type { IContent } from '../../../services/history/IContent.js';
import { JournalRecordingService } from '../../journalRecordingService.js';
import { RecordingIntegration } from '../../RecordingIntegration.js';

export function nativeText(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

export interface NativeIntegrationFixture {
  readonly history: HistoryService;
  readonly recording: JournalRecordingService;
  readonly integration: RecordingIntegration;
  readonly failures: Failures;
  readonly seams: TestJournalSeams;
  readonly directory: string;
  readonly histories: HistoryService[];
  recorded(): Promise<IContent[]>;
  texts(): Promise<string[]>;
}

export async function recordedRows(
  recording: JournalRecordingService,
): Promise<IContent[]> {
  const path = recording.getFilePath();
  if (path === null) throw new Error('Native recorder has no file');
  const reader = await openJournalReadOnly(path);
  try {
    const rows: IContent[] = [];
    const root = rowTreeRootOf(reader.trailer);
    if (root === undefined) return rows;
    for await (const entry of iterateRowEntries(reader, root)) {
      const { speaker, blocks } = decodeStoredRow(
        await readStoredRow(reader, entry),
      );
      rows.push({ speaker, blocks });
    }
    return rows;
  } finally {
    await reader.close();
  }
}

export function useNativeIntegration(): () => NativeIntegrationFixture {
  const directory = useTempDir('native-recording-integration-');
  let fixture: NativeIntegrationFixture;
  beforeEach(() => {
    const failures: Failures = {};
    const seams = testJournalSeams(failures);
    const recording = JournalRecordingService.create({
      sessionId: 'native-integration',
      projectHash: 'native-integration',
      chatsDir: join(directory(), 'chats'),
      workspaceDirs: ['/workspace/project-a'],
      provider: 'anthropic',
      model: 'model-1',
      journal: { journal: seams.dependencies },
    });
    const history = new HistoryService({ backend: 'journal' });
    const integration = new RecordingIntegration(recording);
    fixture = {
      history,
      recording,
      integration,
      failures,
      seams,
      directory: directory(),
      histories: [history],
      recorded: () => recordedRows(recording),
      texts: async () =>
        (await recordedRows(recording)).map((row) =>
          row.blocks
            .map((block) =>
              block.type === 'text' ? block.text : `<${block.type}>`,
            )
            .join(''),
        ),
    };
  });
  afterEach(async () => {
    fixture.seams.release();
    await fixture.integration.dispose();
    for (const history of fixture.histories) await history.dispose();
    await fixture.recording.dispose();
  });
  return () => fixture;
}
