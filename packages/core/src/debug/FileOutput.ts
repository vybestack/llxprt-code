/**
 * @plan PLAN-20250120-DEBUGLOGGING.P10
 * @requirement REQ-005
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { LLXPRT_DIR } from '../utils/paths.js';
import type { LogEntry } from './types.js';

interface QueuedEntry {
  entry: LogEntry;
  timestamp: number;
}

const LOG_FILE_DATE_LENGTH = 10;

export class FileOutput {
  private static instance: FileOutput | undefined;
  private debugDir: string;
  private currentLogFile: string;
  private writeQueue: QueuedEntry[] = [];
  private isWriting = false;
  private disposed = false;
  private flushTimeout: NodeJS.Timeout | null = null;
  private maxFileSize = 10 * 1024 * 1024; // 10MB
  private maxQueueSize = 1000;
  private batchSize = 50;
  private flushInterval = 1000; // 1 second
  private debugRunId: string;

  private constructor() {
    const home = homedir();
    // Handle test environments where homedir might not be available
    this.debugDir = home
      ? join(home, LLXPRT_DIR, 'debug')
      : join(process.cwd(), LLXPRT_DIR, 'debug');
    this.debugRunId =
      process.env.LLXPRT_DEBUG_RUN_ID ||
      process.env.LLXPRT_DEBUG_SESSION_ID ||
      String(process.pid);
    this.currentLogFile = this.generateLogFileName();
  }

  get runId(): string {
    return this.debugRunId;
  }

  static getInstance(): FileOutput {
    if (!FileOutput.instance) {
      FileOutput.instance = new FileOutput();
    }
    return FileOutput.instance;
  }

  static async disposeInstance(): Promise<void> {
    if (FileOutput.instance) {
      await FileOutput.instance.dispose();
    }
  }

  async write(entry: LogEntry): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (!this.flushTimeout) {
      this.startFlushTimer();
    }

    // Add to queue
    this.writeQueue.push({
      entry,
      timestamp: Date.now(),
    });

    // Prevent queue from growing too large
    if (this.writeQueue.length > this.maxQueueSize) {
      this.writeQueue = this.writeQueue.slice(-this.maxQueueSize);
    }

    // Flush immediately if queue is large or not currently writing
    if (this.writeQueue.length >= this.batchSize || !this.isWriting) {
      await this.flushQueue();
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;

    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    while (this.isWriting) {
      await this.waitForWriteTurn();
    }

    let previousQueueLength = Number.POSITIVE_INFINITY;
    while (
      this.writeQueue.length > 0 &&
      this.writeQueue.length < previousQueueLength
    ) {
      previousQueueLength = this.writeQueue.length;
      await this.flushQueue({ allowDisposed: true });
    }

    if (FileOutput.instance === this) {
      FileOutput.instance = undefined;
    }
  }

  static async resetForTesting(): Promise<void> {
    const instance = FileOutput.instance;
    FileOutput.instance = undefined;
    if (instance) {
      await instance.dispose();
    }
  }

  private startFlushTimer(): void {
    if (this.disposed) {
      return;
    }

    if (this.flushTimeout) {
      return;
    }

    this.flushTimeout = setTimeout(() => {
      void (async () => {
        await this.flushQueue();
        this.flushTimeout = null;
        if (this.writeQueue.length > 0) {
          this.startFlushTimer();
        }
      })();
    }, this.flushInterval);
  }

  private async flushQueue(
    options: { allowDisposed?: boolean } = {},
  ): Promise<void> {
    if (
      this.isWriting ||
      this.writeQueue.length === 0 ||
      (this.disposed && !options.allowDisposed)
    ) {
      return;
    }

    this.isWriting = true;
    let entriesToWrite: QueuedEntry[] = [];

    try {
      await this.ensureDirectoryExists();
      await this.checkFileRotation();

      // Process entries in batches
      entriesToWrite = this.writeQueue.splice(0, this.batchSize);

      if (entriesToWrite.length === 0) {
        return;
      }

      // Convert to JSONL format
      const jsonlData =
        entriesToWrite.map(({ entry }) => JSON.stringify(entry)).join('\n') +
        '\n';

      // Write to file with proper permissions
      await fs.appendFile(this.currentLogFile, jsonlData, {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch (error) {
      // Gracefully handle errors - don't crash the application
      console.error('FileOutput: Failed to write log entries:', error);

      // Put entries back in queue for retry (but limit retries)
      if (this.writeQueue.length < this.maxQueueSize / 2) {
        this.writeQueue.unshift(...entriesToWrite);
      }
    } finally {
      this.isWriting = false;
    }
  }

  private async waitForWriteTurn(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  private async ensureDirectoryExists(): Promise<void> {
    try {
      await fs.access(this.debugDir);
    } catch {
      await fs.mkdir(this.debugDir, {
        recursive: true,
        mode: 0o700,
      });
    }
  }

  private async checkFileRotation(): Promise<void> {
    try {
      const stats = await fs.stat(this.currentLogFile);

      // Rotate by size
      if (stats.size >= this.maxFileSize) {
        this.currentLogFile = this.generateLogFileName();
        return;
      }

      // Rotate by date (daily rotation)
      const fileDate = new Date(stats.birthtime);
      const today = new Date();
      if (fileDate.toDateString() !== today.toDateString()) {
        this.currentLogFile = this.generateLogFileName();
      }
    } catch {
      // File doesn't exist yet, that's fine
    }
  }

  private generateLogFileName(): string {
    const now = new Date();
    const datePart = now.toISOString().slice(0, LOG_FILE_DATE_LENGTH);
    const timePart = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    return join(
      this.debugDir,
      `llxprt-debug-${this.debugRunId}-${datePart}-${timePart}.jsonl`,
    );
  }
}
