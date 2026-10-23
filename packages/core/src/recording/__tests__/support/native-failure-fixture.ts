/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { testJournalSeams } from '../../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../journal/__tests__/support/useTempDir.js';
import type { JournalOpenDependencies } from '../../../journal/journalWriterOpen.js';
import type { JournalFileHandle } from '../../../journal/positionalFile.js';
import { TRAILER_RECORD_BYTES } from '../../../journal/trailerRecord.js';
import { HistoryService } from '../../../services/history/HistoryService.js';
import { JournalRecordingService } from '../../journalRecordingService.js';
import { RecordingIntegration } from '../../RecordingIntegration.js';
import { nativeText } from './native-integration-fixture.js';

export interface NativeFailureControl {
  writeError?: unknown;
  readError?: unknown;
  flushError?: unknown;
  closeError?: unknown;
  writeMode?: 'zero' | 'partial' | 'records' | 'trailer';
  fragments: number;
}
interface NativeFailureFixture {
  history: HistoryService;
  recording: JournalRecordingService;
  integration: RecordingIntegration;
  control: NativeFailureControl;
  directory: string;
  reports: string;
}

function failingHandle(
  handle: JournalFileHandle,
  control: NativeFailureControl,
): JournalFileHandle {
  return {
    ...handle,
    read: async (buffer, offset, length, position) => {
      if (control.readError !== undefined) throw control.readError;
      return handle.read(buffer, offset, length, position);
    },
    write: async (buffer, offset, length, position) => {
      if (control.writeMode === 'zero') return { bytesWritten: 0 };
      if (control.writeMode === 'trailer' && length === TRAILER_RECORD_BYTES) {
        await handle.write(buffer, offset, 7, position);
        control.fragments += 1;
        throw control.writeError;
      }
      if (control.writeError !== undefined && control.writeMode !== 'trailer')
        throw control.writeError;
      const limit = control.writeMode === 'partial' ? 7 : length;
      if (limit < length) control.fragments += 1;
      return handle.write(buffer, offset, Math.min(length, limit), position);
    },
    writev: async (buffers, position) => {
      if (control.writeMode === 'zero') return { bytesWritten: 0 };
      if (control.writeMode === 'records') {
        await handle.write(
          buffers[0],
          0,
          Math.min(7, buffers[0].length),
          position,
        );
        control.fragments += 1;
        throw control.writeError;
      }
      if (control.writeError !== undefined && control.writeMode !== 'trailer')
        throw control.writeError;
      if (control.writeMode === 'partial') {
        control.fragments += 1;
        return handle.write(
          buffers[0],
          0,
          Math.min(7, buffers[0].length),
          position,
        );
      }
      return handle.writev(buffers, position);
    },
    close: async () => {
      await handle.close();
      if (control.closeError !== undefined) throw control.closeError;
    },
  };
}

function failingDependencies(
  control: NativeFailureControl,
): JournalOpenDependencies {
  const dependencies = testJournalSeams({}, 1, false).dependencies;
  return {
    ...dependencies,
    flush: (fd) => {
      if (control.flushError !== undefined) throw control.flushError;
      dependencies.flush(fd);
    },
    open: async (path, flags) =>
      failingHandle(await dependencies.open(path, flags), control),
  };
}

export function useNativeFailureIntegration(): () => NativeFailureFixture {
  const directory = useTempDir('native-failure-contract-');
  let fixture: NativeFailureFixture;
  beforeEach(async () => {
    const control: NativeFailureControl = { fragments: 0 };
    const recording = JournalRecordingService.create({
      sessionId: 'native-failure',
      projectHash: 'native-failure',
      chatsDir: join(directory(), 'chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      journal: { journal: failingDependencies(control) },
    });
    const history = new HistoryService({});
    const reports = join(directory(), 'reports');
    const integration = new RecordingIntegration(recording, undefined, reports);
    fixture = {
      history,
      recording,
      integration,
      control,
      directory: directory(),
      reports,
    };
    await integration.subscribeToJournal(history);
    history.add(nativeText('durable baseline'));
    await integration.flushAtTurnBoundary();
  });
  afterEach(async () => {
    fixture.control.closeError = undefined;
    await fixture.integration.dispose();
    await fixture.history.dispose();
    await fixture.recording.dispose();
  });
  return () => fixture;
}

export async function rejected(operation: Promise<void>): Promise<unknown> {
  try {
    await operation;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected native failure');
}
