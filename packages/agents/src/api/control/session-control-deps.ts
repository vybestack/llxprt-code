import type { ScratchRootOwner } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  NamedWriterOwnership,
  LocalMediaStore,
} from '@vybestack/llxprt-code-core';
import type { SessionNativeHistory } from './session-history-observation.js';
import type { PreparedRecordingSession } from '../../session/session-new-client.js';
export interface SessionRecordingPaths {
  readonly scratchRoots: ScratchRootOwner;
  readonly namedWriters?: NamedWriterOwnership;
  readonly storageRoot: string;
  readonly projectTempDir: string;
  readonly projectChatsDir: string;
  readonly projectRoot: string;
  readonly persistenceQueueBytes: number;
}
export interface SessionControlDeps {
  readonly paths: SessionRecordingPaths;
  readonly mediaStore: LocalMediaStore;
  readonly readRecordingQueueLimit: () => number;
  readonly directories: () => readonly string[];
  readonly sessionIdentityOwnership: 'config' | 'facade';
  readonly sessionId: () => string;
  readonly nativeHistory: SessionNativeHistory;
  readonly withSessionTransition: (
    operation: () => Promise<void>,
  ) => Promise<void>;
  readonly closeSessionAdmission: () => void;
  readonly prepareNewSessionClient: (
    sessionId: string,
  ) => Promise<PreparedRecordingSession>;
  readonly getProvider: () => string;
  readonly getModel: () => string;
  readonly readOwnedSessionId: () => string;
  readonly adoptOwnedSessionId: (sessionId: string) => void;
}
