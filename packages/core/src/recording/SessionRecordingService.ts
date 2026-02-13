/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20260211-SESSIONRECORDING.P05
 * @requirement REQ-REC-001, REQ-REC-002, REQ-REC-003, REQ-REC-004, REQ-REC-005, REQ-REC-006, REQ-REC-007, REQ-REC-008
 * @pseudocode session-recording-service.md lines 40-212
 *
 * Session recording service that writes events to a JSONL file.
 * Uses synchronous enqueue with async background writes, deferred
 * file materialization, and graceful ENOSPC handling.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { mkdirSync } from 'node:fs';
import { type IContent } from '../services/history/IContent.js';
import {
  type SessionRecordingServiceConfig,
  type SessionEventType,
  type SessionRecordLine,
} from './types.js';

/**
 * Core service for recording session events to a JSONL file.
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P05
 * @requirement REQ-REC-003, REQ-REC-004, REQ-REC-005, REQ-REC-006, REQ-REC-007, REQ-REC-008
 * @pseudocode session-recording-service.md lines 40-185
 */
export class SessionRecordingService {
  /** @pseudocode session-recording-service.md lines 40-51 */
  private queue: SessionRecordLine[] = [];
  private seq: number = 0;
  private filePath: string | null = null;
  private materialized: boolean = false;
  private active: boolean = true;
  private draining: boolean = false;
  private drainPromise: Promise<void> | null = null;
  private readonly sessionId: string;
  private readonly chatsDir: string;
  private preContentBuffer: SessionRecordLine[] = [];

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-003
   * @pseudocode session-recording-service.md lines 53-67
   */
  constructor(config: SessionRecordingServiceConfig) {
    this.sessionId = config.sessionId;
    this.chatsDir = config.chatsDir;

    const startPayload = {
      sessionId: config.sessionId,
      projectHash: config.projectHash,
      workspaceDirs: config.workspaceDirs,
      provider: config.provider,
      model: config.model,
      startTime: new Date().toISOString(),
    };
    this.bufferPreContent('session_start', startPayload);
  }

  /**
   * Buffer an event before file materialization (before first content event).
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-004
   * @pseudocode session-recording-service.md lines 69-79
   */
  private bufferPreContent(type: SessionEventType, payload: unknown): void {
    this.seq++;
    const line: SessionRecordLine = {
      v: 1,
      seq: this.seq,
      ts: new Date().toISOString(),
      type,
      payload,
    };
    this.preContentBuffer.push(line);
  }

  /**
   * Enqueue an event for writing to the JSONL file.
   * Synchronous and non-blocking — actual I/O happens in the background.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-003, REQ-REC-004
   * @pseudocode session-recording-service.md lines 81-110
   */
  enqueue(type: SessionEventType, payload: unknown): void {
    if (!this.active) return;

    if (type === 'content' && !this.materialized) {
      this.materialize();
      for (const buffered of this.preContentBuffer) {
        this.queue.push(buffered);
      }
      this.preContentBuffer = [];
      this.materialized = true;
    }

    if (!this.materialized && type !== 'content') {
      this.bufferPreContent(type, payload);
      return;
    }

    this.seq++;
    const line: SessionRecordLine = {
      v: 1,
      seq: this.seq,
      ts: new Date().toISOString(),
      type,
      payload,
    };
    this.queue.push(line);
    this.scheduleDrain();
  }

  /**
   * Construct the filename and ensure the chats directory exists.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-004
   * @pseudocode session-recording-service.md lines 112-118
   */
  private materialize(): void {
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 16).replace(':', '-');
    const prefix = this.sessionId.substring(0, 8);
    const fileName = `session-${timestamp}-${prefix}.jsonl`;
    this.filePath = path.join(this.chatsDir, fileName);
    mkdirSync(this.chatsDir, { recursive: true });
  }

  /**
   * Schedule a background drain of the queue.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-003
   * @pseudocode session-recording-service.md lines 120-124
   */
  private scheduleDrain(): void {
    if (this.draining) return;
    this.draining = true;
    this.drainPromise = this.drain();
  }

  /**
   * Drain the queue by writing all queued events to disk via appendFile.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-005, REQ-REC-006
   * @pseudocode session-recording-service.md lines 126-146
   */
  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = [...this.queue];
      this.queue = [];
      let lines = '';
      for (const event of batch) {
        lines += JSON.stringify(event) + '\n';
      }
      try {
        await fs.appendFile(this.filePath!, lines, 'utf-8');
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOSPC' || code === 'EACCES') {
          this.active = false;
          return;
        }
        throw error;
      }
    }
    this.draining = false;
  }

  /**
   * Flush all queued events to disk.
   * Returns a Promise that resolves when all pending writes are complete.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-005
   * @pseudocode session-recording-service.md lines 148-160
   */
  async flush(): Promise<void> {
    if (!this.active) return;
    if (this.queue.length === 0 && !this.draining) return;

    if (this.drainPromise) {
      await this.drainPromise;
    }

    if (this.queue.length > 0) {
      this.drainPromise = this.drain();
      await this.drainPromise;
    }
  }

  /**
   * Whether recording is active (not disabled by ENOSPC or disposal).
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-007
   * @pseudocode session-recording-service.md line 162-164
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Path to the JSONL file, or null if not yet materialized.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-004
   * @pseudocode session-recording-service.md lines 166-168
   */
  getFilePath(): string | null {
    return this.filePath;
  }

  /**
   * The session identifier for this recording.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-003
   * @pseudocode session-recording-service.md lines 170-172
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Initialize for resuming an existing session file.
   * Sets the file path and sequence counter so new events append correctly.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-008
   * @pseudocode session-recording-service.md lines 174-179
   */
  initializeForResume(filePath: string, lastSeq: number): void {
    this.filePath = filePath;
    this.seq = lastSeq;
    this.materialized = true;
    this.preContentBuffer = [];
  }

  /**
   * Dispose of the service, stopping all recording activity.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-003
   * @pseudocode session-recording-service.md lines 181-185
   */
  dispose(): void {
    this.active = false;
    this.queue = [];
    this.preContentBuffer = [];
  }

  // -------------------------------------------------------------------------
  // Convenience methods — delegate to enqueue with typed payloads
  // @pseudocode session-recording-service.md lines 190-212
  // -------------------------------------------------------------------------

  /**
   * Record a content event (user message, AI response, or tool interaction).
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-002
   * @pseudocode session-recording-service.md lines 190-192
   */
  recordContent(content: IContent): void {
    this.enqueue('content', { content });
  }

  /**
   * Record a compression event — history was compressed into a summary.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-002
   * @pseudocode session-recording-service.md lines 194-196
   */
  recordCompressed(summary: IContent, itemsCompressed: number): void {
    this.enqueue('compressed', { summary, itemsCompressed });
  }

  /**
   * Record a rewind event — last N items removed from history.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-002
   * @pseudocode session-recording-service.md lines 198-200
   */
  recordRewind(itemsRemoved: number): void {
    this.enqueue('rewind', { itemsRemoved });
  }

  /**
   * Record a provider/model switch event.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-002
   * @pseudocode session-recording-service.md lines 202-204
   */
  recordProviderSwitch(provider: string, model: string): void {
    this.enqueue('provider_switch', { provider, model });
  }

  /**
   * Record an operational session event (info, warning, or error).
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-002
   * @pseudocode session-recording-service.md lines 206-208
   */
  recordSessionEvent(
    severity: 'info' | 'warning' | 'error',
    message: string,
  ): void {
    this.enqueue('session_event', { severity, message });
  }

  /**
   * Record a workspace directories change event.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-002
   * @pseudocode session-recording-service.md lines 210-212
   */
  recordDirectoriesChanged(directories: string[]): void {
    this.enqueue('directories_changed', { directories });
  }
}
