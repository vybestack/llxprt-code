/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  SessionPersistenceService,
  type SessionPersistenceServiceOptions,
  type LocalMediaStore,
} from '@vybestack/llxprt-code-core';

export interface CliSessionPersistencePort {
  readonly mediaStore: LocalMediaStore | undefined;
  forRecording(sessionId: string): SessionPersistenceService;
}

export class CliSessionPersistence implements CliSessionPersistencePort {
  private readonly journals = new Map<string, SessionPersistenceService>();
  private closed = false;

  constructor(
    private readonly paths: {
      readonly projectRoot: string;
      readonly chatsDir: string;
    },
    private readonly options: SessionPersistenceServiceOptions,
  ) {}

  get mediaStore(): LocalMediaStore | undefined {
    if (this.closed) throw new Error('CLI session persistence is closed');
    return this.options.mediaStore;
  }

  forRecording(sessionId: string): SessionPersistenceService {
    if (this.closed) throw new Error('CLI session persistence is closed');
    let journal = this.journals.get(sessionId);
    if (journal === undefined) {
      journal = new SessionPersistenceService(
        this.paths,
        sessionId,
        this.options,
      );
      this.journals.set(sessionId, journal);
    }
    return journal;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.journals.clear();
  }
}
