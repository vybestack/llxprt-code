import {
  Logger,
  MessageSenderType,
  Storage,
} from '@vybestack/llxprt-code-core';
import { getLogger } from '../../lib/logger';

const debug = getLogger('nui:persistent-history');

/**
 * Service for persistent prompt history that shares data with llxprt-code.
 * History is stored in ~/.llxprt/tmp/{project-hash}/logs.json
 */
export class PersistentHistoryService {
  private logger: Logger | null = null;
  private initialized = false;
  private cachedHistory: string[] = [];

  constructor(
    private readonly workingDir: string,
    private readonly sessionId: string,
  ) {}

  /**
   * Initialize the history service. Must be called before using other methods.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const storage = new Storage(this.workingDir);
      this.logger = new Logger(this.sessionId, storage);
      await this.logger.initialize();

      // Load existing history
      this.cachedHistory = await this.logger.getPreviousUserMessages();
      debug.debug('Loaded history', 'count:', this.cachedHistory.length);

      this.initialized = true;
    } catch (err) {
      debug.error('Failed to initialize persistent history:', String(err));
      this.initialized = false;
    }
  }

  /**
   * Record a new prompt to persistent storage.
   */
  async record(prompt: string): Promise<void> {
    if (!this.initialized || !this.logger) {
      debug.warn('Cannot record: history service not initialized');
      return;
    }

    try {
      await this.logger.logMessage(MessageSenderType.USER, prompt);
      // Add to cache (at the beginning since getPreviousUserMessages returns newest first)
      this.cachedHistory.unshift(prompt);
      debug.debug('Recorded prompt to history');
    } catch (err) {
      debug.error('Failed to record prompt:', String(err));
    }
  }

  /**
   * Get all previous user messages, newest first.
   */
  getHistory(): string[] {
    return this.cachedHistory;
  }

  /**
   * Get the number of history entries.
   */
  get count(): number {
    return this.cachedHistory.length;
  }

  /**
   * Close the history service.
   */
  close(): void {
    if (this.logger) {
      this.logger.close();
      this.logger = null;
    }
    this.initialized = false;
    this.cachedHistory = [];
  }
}

/**
 * Create a persistent history service for the given working directory.
 */
export function createPersistentHistory(
  workingDir: string,
  sessionId: string,
): PersistentHistoryService {
  return new PersistentHistoryService(workingDir, sessionId);
}
