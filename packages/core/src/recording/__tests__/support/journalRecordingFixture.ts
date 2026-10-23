/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, spyOn } from 'bun:test';
import * as positional from '../../../journal/positionalFile.js';
import * as codec from '../../../services/history/journalRowCodec.js';
import type { IContent } from '../../../services/history/IContent.js';
import { JournalRecordingService } from '../../journalRecordingService.js';
import type { JournalRecordingConfig } from '../../journalRecordingService.js';
import { JournalResumeBoot } from '../../journalResume.js';
import type { ForkResult, ForkError } from '../../SessionTransitionService.js';
import type { ContinueTarget } from '../../types.js';
import type { ResumeResult, ResumeError } from '../../resumeSession.js';

export const PROJECT_HASH = 'recording-journal-fixture';
export const SMALL_N = 40;
export const LARGE_N = 4000;
export const PAGE_BOUND = 256;

export function textRow(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

export function rowTexts(rows: readonly IContent[]): string[] {
  return rows.map((row) =>
    row.blocks
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join(''),
  );
}

export function recordingConfig(
  chatsDir: string,
  overrides: Partial<JournalRecordingConfig> = {},
): JournalRecordingConfig {
  return {
    sessionId: crypto.randomUUID(),
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/test/workspace'],
    provider: 'test',
    model: 'model',
    ...overrides,
  };
}

export async function seedRecording(
  chatsDir: string,
  count = 2,
  options: Partial<JournalRecordingConfig> & {
    name?: string;
    checkpointAfter?: number;
  } = {},
): Promise<{
  recording: JournalRecordingService;
  filePath: string;
  contents: IContent[];
  target?: Extract<ContinueTarget, { kind: 'checkpoint' }>;
}> {
  const { name, checkpointAfter, ...config } = options;
  const recording = JournalRecordingService.create(
    recordingConfig(chatsDir, config),
  );
  try {
    const session = await recording.session();
    const contents = Array.from({ length: count }, (_, index) =>
      textRow(`row-${index}`, index % 2 === 0 ? 'human' : 'ai'),
    );
    const cut = checkpointAfter ?? count;
    if (cut > 0) await session.append(contents.slice(0, cut));
    const checkpoint =
      checkpointAfter === undefined
        ? undefined
        : await recording.createCheckpoint('keep');
    if (cut < count) await session.append(contents.slice(cut));
    if (name !== undefined) await recording.setSessionName(name);
    await recording.flush();
    const filePath = recording.getFilePath();
    if (filePath === null) throw new Error('Missing journal');
    return {
      recording,
      filePath,
      contents,
      ...(checkpoint === undefined
        ? {}
        : {
            target: {
              kind: 'checkpoint',
              checkpointId: checkpoint.checkpointId,
              checkpointName: checkpoint.name,
              sequence: checkpoint.sequence,
              source: {
                sessionId: recording.getSessionId(),
                filePath,
                projectHash: config.projectHash ?? PROJECT_HASH,
                startTime: new Date().toISOString(),
                lastModified: new Date(),
                fileSize: 0,
                provider: 'test',
                model: 'model',
              },
            } satisfies Extract<ContinueTarget, { kind: 'checkpoint' }>,
          }),
    };
  } finally {
    await recording.dispose();
  }
}

export function requireBoot(
  result: ResumeResult | ResumeError | ForkResult | ForkError,
): JournalResumeBoot {
  if (!result.ok) throw new Error(result.error);
  if (!(result.boot instanceof JournalResumeBoot))
    throw new Error('Expected journal boot');
  return result.boot;
}

export function useJournalReadProbe(): () => {
  reads: number;
  decodedRows: number;
  activeReads: number;
  peakReads: number;
  reset(): void;
} {
  const read = positional.createFileHandleReader;
  const decode = codec.decodeStoredRow;
  const stats = {
    reads: 0,
    decodedRows: 0,
    activeReads: 0,
    peakReads: 0,
    reset: (): void => {
      stats.reads = 0;
      stats.decodedRows = 0;
      stats.peakReads = 0;
    },
  };
  let restore: () => void = () => undefined;
  beforeEach(() => {
    stats.reset();
    const readerSpy = spyOn(
      positional,
      'createFileHandleReader',
    ).mockImplementation((handle) =>
      read({
        read: async (buffer, offset, length, position) => {
          stats.reads += 1;
          stats.activeReads += 1;
          stats.peakReads = Math.max(stats.peakReads, stats.activeReads);
          try {
            return await handle.read(buffer, offset, length, position);
          } finally {
            stats.activeReads -= 1;
          }
        },
      }),
    );
    const decoderSpy = spyOn(codec, 'decodeStoredRow').mockImplementation(
      (...args) => {
        stats.decodedRows += 1;
        return decode(...args);
      },
    );
    restore = () => {
      readerSpy.mockRestore();
      decoderSpy.mockRestore();
    };
  });
  afterEach(() => restore());
  return () => stats;
}
