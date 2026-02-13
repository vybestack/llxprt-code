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

import { type IContent } from '../services/history/IContent.js';
import { type HistoryService } from '../services/history/HistoryService.js';
import { type SessionRecordingService } from './SessionRecordingService.js';

type HistoryEventEmitter = {
  on(event: 'contentAdded', listener: (content: IContent) => void): unknown;
  on(event: 'compressionStarted', listener: () => void): unknown;
  on(
    event: 'compressionEnded',
    listener: (summary: IContent, itemsCompressed: number) => void,
  ): unknown;
  off(event: 'contentAdded', listener: (content: IContent) => void): unknown;
  off(event: 'compressionStarted', listener: () => void): unknown;
  off(
    event: 'compressionEnded',
    listener: (summary: IContent, itemsCompressed: number) => void,
  ): unknown;
};

/**
 * Bridges HistoryService events to SessionRecordingService.
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P14
 * @requirement REQ-INT-001, REQ-INT-002, REQ-INT-003, REQ-INT-004, REQ-INT-005, REQ-INT-006, REQ-INT-007
 * @pseudocode recording-integration.md lines 30-104
 */
export class RecordingIntegration {
  private readonly recording: SessionRecordingService;
  private historySubscription: (() => void) | null = null;
  private compressionInProgress = false;
  private disposed = false;

  constructor(recording: SessionRecordingService) {
    this.recording = recording;
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-001, REQ-INT-002
   * @pseudocode recording-integration.md lines 39-71
   */
  subscribeToHistory(historyService: HistoryService): void {
    this.unsubscribeFromHistory();
    if (this.disposed) {
      return;
    }

    const historyEvents = historyService as unknown as HistoryEventEmitter;

    const onContentAdded = (content: IContent) => {
      if (this.disposed || this.compressionInProgress) {
        return;
      }
      this.recording.recordContent(content);
    };

    const onCompressionStarted = () => {
      if (this.disposed) {
        return;
      }
      this.compressionInProgress = true;
    };

    const onCompressionEnded = (summary: IContent, itemsCompressed: number) => {
      if (this.disposed) {
        return;
      }
      this.compressionInProgress = false;
      this.recording.recordCompressed(summary, itemsCompressed);
    };

    historyEvents.on('contentAdded', onContentAdded);
    historyEvents.on('compressionStarted', onCompressionStarted);
    historyEvents.on('compressionEnded', onCompressionEnded);

    this.historySubscription = () => {
      historyEvents.off('contentAdded', onContentAdded);
      historyEvents.off('compressionStarted', onCompressionStarted);
      historyEvents.off('compressionEnded', onCompressionEnded);
    };
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-001, REQ-INT-006
   * @pseudocode recording-integration.md lines 73-78
   */
  unsubscribeFromHistory(): void {
    if (!this.historySubscription) {
      return;
    }

    this.historySubscription();
    this.historySubscription = null;
    this.compressionInProgress = false;
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-003
   * @pseudocode recording-integration.md lines 80-82
   */
  recordProviderSwitch(provider: string, model: string): void {
    if (this.disposed) {
      return;
    }
    this.recording.recordProviderSwitch(provider, model);
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-003
   * @pseudocode recording-integration.md lines 84-86
   */
  recordDirectoriesChanged(dirs: string[]): void {
    if (this.disposed) {
      return;
    }
    this.recording.recordDirectoriesChanged(dirs);
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-003
   * @pseudocode recording-integration.md lines 88-90
   */
  recordSessionEvent(
    severity: 'info' | 'warning' | 'error',
    message: string,
  ): void {
    if (this.disposed) {
      return;
    }
    this.recording.recordSessionEvent(severity, message);
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-004, REQ-INT-007
   * @pseudocode recording-integration.md lines 92-94
   */
  async flushAtTurnBoundary(): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.recording.flush();
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-006
   * @pseudocode recording-integration.md lines 96-98
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribeFromHistory();
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-005
   * @pseudocode recording-integration.md lines 102-104
   */
  onHistoryServiceReplaced(newHistoryService: HistoryService): void {
    this.subscribeToHistory(newHistoryService);
  }
}
