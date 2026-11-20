/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalSessionOptions } from '../services/history/journalSession.js';
import { createJournalChildSession } from './journalChildSession.js';
import type { SessionRecordingPort } from './recordingPort.js';
import type { RecordingWriterIo } from './types.js';

export interface ChildSessionJournalOptions {
  readonly sessionId?: string;
  parentSessionId: string;
  projectHash: string;
  chatsDir: string;
  workspaceDirs: readonly string[];
  provider: string;
  model: string;
  readonly io?: RecordingWriterIo;
  readonly journal?: JournalSessionOptions;
}

export interface ChildSessionJournal {
  readonly sessionId: string;
  readonly recording: SessionRecordingPort;
  dispose(): Promise<void>;
}

export function createChildSessionJournal(
  options: ChildSessionJournalOptions,
): Promise<ChildSessionJournal> {
  return createJournalChildSession(options);
}
