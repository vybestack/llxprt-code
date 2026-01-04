/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { type IContent } from '../services/history/IContent.js';
import { Storage } from '../config/storage.js';
import { DebugLogger } from '../debug/index.js';
import {
  type ToolResultDisplay,
  type ToolCallConfirmationDetails,
} from '../tools/tools.js';

const logger = new DebugLogger('llxprt:session:persistence');

/**
 * Persisted tool call display information.
 * Matches CLI's IndividualToolCallDisplay interface for type compatibility.
 */
export interface PersistedToolCall {
  /** Unique identifier for the tool call */
  callId: string;
  /** Tool name */
  name: string;
  /** Human-readable description of what the tool is doing */
  description: string;
  /** Tool execution status (string to accept CLI's ToolCallStatus enum) */
  status: string;
  /** Result display for completed tools */
  resultDisplay: ToolResultDisplay | undefined;
  /** Confirmation details for tools requiring user approval */
  confirmationDetails: ToolCallConfirmationDetails | undefined;
  /** Whether to render output as markdown */
  renderOutputAsMarkdown?: boolean;
  /** Whether this tool is currently focused in UI */
  isFocused?: boolean;
}

/**
 * Minimal interface for persisted UI history items.
 * CLI's HistoryItem should satisfy this interface.
 * Uses permissive types since CLI has multiple history types with different shapes.
 */
export interface PersistedUIHistoryItem {
  /** Unique identifier for the history item */
  id: number;
  /** Type discriminator for the history item */
  type: string;
  /** Optional text content (for user/gemini/info/warning/error messages) */
  text?: string;
  /** Optional model identifier (for gemini responses) */
  model?: string;
  /** Optional agent ID (for subagent contexts) */
  agentId?: string;
  /** Optional tools array - shape varies by type (tool_group vs tools_list) */
  tools?: unknown[];
}

/**
 * Persisted session format for --continue functionality
 */
export interface PersistedSession {
  /** Schema version for future migrations */
  version: 1;
  /** Unique session identifier */
  sessionId: string;
  /** Hash of project root for validation */
  projectHash: string;
  /** When session was created */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Full conversation history (core format) */
  history: IContent[];
  /** UI history items for display restoration (preserves exactly what user sees) */
  uiHistory?: PersistedUIHistoryItem[];
  /** Optional metadata */
  metadata?: {
    provider?: string;
    model?: string;
    tokenCount?: number;
  };
}

/**
 * Session file prefix for persistence files
 */
const PERSISTED_SESSION_PREFIX = 'persisted-session-';

/**
 * Service for persisting and restoring conversation sessions.
 * Enables the --continue flag to resume previous sessions.
 */
export class SessionPersistenceService {
  private readonly storage: Storage;
  private readonly sessionId: string;
  private readonly chatsDir: string;
  private readonly sessionFilePath: string;

  constructor(storage: Storage, sessionId: string) {
    this.storage = storage;
    this.sessionId = sessionId;
    this.chatsDir = path.join(storage.getProjectTempDir(), 'chats');

    // Use timestamp-based filename for easy "most recent" lookup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.sessionFilePath = path.join(
      this.chatsDir,
      `${PERSISTED_SESSION_PREFIX}${timestamp}.json`,
    );
  }

  /**
   * Get the directory containing persisted sessions
   */
  getChatsDir(): string {
    return this.chatsDir;
  }

  /**
   * Get the current session's file path
   */
  getSessionFilePath(): string {
    return this.sessionFilePath;
  }

  /**
   * Save conversation history to disk
   */
  async save(
    history: IContent[],
    metadata?: PersistedSession['metadata'],
    uiHistory?: PersistedUIHistoryItem[],
  ): Promise<void> {
    try {
      // Ensure chats directory exists
      await fs.promises.mkdir(this.chatsDir, { recursive: true });

      const session: PersistedSession = {
        version: 1,
        sessionId: this.sessionId,
        projectHash: this.getProjectHash(),
        createdAt: this.getCreatedAt(),
        updatedAt: new Date().toISOString(),
        history,
        uiHistory,
        metadata,
      };

      // Write to temp file first, then rename for atomic write
      const tempPath = `${this.sessionFilePath}.tmp`;
      await fs.promises.writeFile(
        tempPath,
        JSON.stringify(session, null, 2),
        'utf-8',
      );
      await fs.promises.rename(tempPath, this.sessionFilePath);

      logger.debug('Session saved:', {
        path: this.sessionFilePath,
        historyLength: history.length,
        metadata,
      });
    } catch (error) {
      logger.error('Failed to save session:', error);
      throw error;
    }
  }

  /**
   * Load the most recent session for this project
   */
  async loadMostRecent(): Promise<PersistedSession | null> {
    try {
      // Find all persisted session files (readdir throws ENOENT if dir doesn't exist)
      let files: string[];
      try {
        files = await fs.promises.readdir(this.chatsDir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          logger.debug('No chats directory found');
          return null;
        }
        throw err;
      }
      const sessionFiles = files
        .filter(
          (f) => f.startsWith(PERSISTED_SESSION_PREFIX) && f.endsWith('.json'),
        )
        .sort()
        .reverse(); // Most recent first (timestamp-based naming)

      if (sessionFiles.length === 0) {
        logger.debug('No persisted sessions found');
        return null;
      }

      const mostRecentFile = sessionFiles[0];
      const filePath = path.join(this.chatsDir, mostRecentFile);

      logger.debug('Loading most recent session:', filePath);

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const session = JSON.parse(content) as PersistedSession;

      // Validate project hash matches
      const currentProjectHash = this.getProjectHash();
      if (session.projectHash !== currentProjectHash) {
        logger.warn('Session project hash mismatch, skipping:', {
          expected: currentProjectHash,
          found: session.projectHash,
        });
        return null;
      }

      // Validate version
      if (session.version !== 1) {
        logger.warn('Unknown session version:', session.version);
        return null;
      }

      logger.debug('Session loaded:', {
        sessionId: session.sessionId,
        historyLength: session.history.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });

      return session;
    } catch (error) {
      logger.error('Failed to load session:', error);

      // If file is corrupted, back it up and return null
      if (error instanceof SyntaxError) {
        await this.backupCorruptedSession();
      }

      return null;
    }
  }

  /**
   * Get formatted timestamp for display
   */
  static formatSessionTime(session: PersistedSession): string {
    const date = new Date(session.updatedAt || session.createdAt);
    return date.toLocaleString();
  }

  /**
   * Get project hash for validation
   */
  private getProjectHash(): string {
    const projectRoot = this.storage.getProjectRoot();
    return crypto.createHash('sha256').update(projectRoot).digest('hex');
  }

  /**
   * Get or track session creation time
   */
  private createdAt: string | null = null;
  private getCreatedAt(): string {
    if (!this.createdAt) {
      this.createdAt = new Date().toISOString();
    }
    return this.createdAt;
  }

  /**
   * Back up corrupted session file
   */
  private async backupCorruptedSession(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.chatsDir);
      const sessionFiles = files
        .filter(
          (f) => f.startsWith(PERSISTED_SESSION_PREFIX) && f.endsWith('.json'),
        )
        .sort()
        .reverse();

      if (sessionFiles.length > 0) {
        const corruptedFile = path.join(this.chatsDir, sessionFiles[0]);
        const backupFile = `${corruptedFile}.corrupted-${Date.now()}`;
        await fs.promises.rename(corruptedFile, backupFile);
        logger.warn('Backed up corrupted session to:', backupFile);
      }
    } catch (backupError) {
      logger.error('Failed to backup corrupted session:', backupError);
    }
  }
}
