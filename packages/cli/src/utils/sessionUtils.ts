/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SESSION_FILE_PREFIX,
  type ConversationRecord,
  type Config,
} from '@vybestack/llxprt-code-core';
import * as fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Constant for the resume "latest" identifier.
 * Used when --resume is passed without a value to select the most recent session.
 */
export const RESUME_LATEST = 'latest';

/**
 * Session information for display and selection purposes.
 */
export interface SessionInfo {
  /** Unique session identifier (filename without .json) */
  id: string;
  /** Session file stem (without .json extension) */
  file?: string;
  /** Full filename including .json extension */
  fileName: string;
  /** ISO timestamp when session started */
  startTime?: string;
  /** ISO timestamp when session was last updated */
  lastUpdated: string;
  /** First user message in the session */
  firstUserMessage?: string;
  /** Whether this is the currently active session */
  isCurrentSession: boolean;
}

/**
 * Result of selecting a session to resume.
 */
export interface SessionSelectionResult {
  /** Path to the session file */
  sessionPath: string;
  /** Parsed session data */
  sessionData: ConversationRecord;
}

/**
 * Represents a session file, which may be valid or corrupted.
 */
export interface SessionFileEntry {
  /** Full filename including .json extension */
  fileName: string;
  /** Parsed session info if valid, null if corrupted */
  sessionInfo: SessionInfo | null;
}

/**
 * Loads all session files (including corrupted ones) from the chats directory.
 * @returns Array of session file entries, with sessionInfo null for corrupted files
 */
export const getAllSessionFiles = async (
  chatsDir: string,
  currentSessionId?: string,
): Promise<SessionFileEntry[]> => {
  try {
    const files = await fs.readdir(chatsDir);
    const sessionFiles = files
      .filter((f) => f.startsWith(SESSION_FILE_PREFIX) && f.endsWith('.json'))
      .sort(); // Sort by filename, which includes timestamp

    const sessionPromises = sessionFiles.map(
      async (file): Promise<SessionFileEntry> => {
        const filePath = path.join(chatsDir, file);
        try {
          const content: ConversationRecord = JSON.parse(
            await fs.readFile(filePath, 'utf8'),
          );

          // Validate required fields
          if (
            !content.sessionId ||
            !content.messages ||
            !Array.isArray(content.messages) ||
            !content.startTime ||
            !content.lastUpdated
          ) {
            // Missing required fields - treat as corrupted
            return { fileName: file, sessionInfo: null };
          }

          const isCurrentSession = currentSessionId
            ? file.includes(currentSessionId.slice(0, 8))
            : false;

          const userMsg = content.messages.find(
            (m) => m.role === 'user',
          ) as unknown as Record<string, unknown> | undefined;
          // Session files may have extended message records with parts/text
          const firstUserMessage =
            (userMsg?.text as string) ??
            (userMsg?.parts as Array<{ text?: string }> | undefined)?.[0]
              ?.text ??
            '(no message)';

          const sessionInfo: SessionInfo = {
            id: content.sessionId,
            file: file.replace(/\.json$/, ''),
            fileName: file,
            startTime: content.startTime,
            lastUpdated: content.lastUpdated,
            firstUserMessage,
            isCurrentSession,
          };

          return { fileName: file, sessionInfo };
        } catch {
          // File is corrupted (can't read or parse JSON)
          return { fileName: file, sessionInfo: null };
        }
      },
    );
    return await Promise.all(sessionPromises);
  } catch (error) {
    // It's expected that the directory might not exist, which is not an error.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    // For other errors (e.g., permissions), re-throw to be handled by the caller.
    throw error;
  }
};

/**
 * Loads all valid session files from the chats directory and converts them to SessionInfo.
 * Corrupted files are automatically filtered out.
 */
export const getSessionFiles = async (
  chatsDir: string,
  currentSessionId?: string,
): Promise<SessionInfo[]> => {
  const allFiles = await getAllSessionFiles(chatsDir, currentSessionId);

  // Filter out corrupted files and extract SessionInfo
  const validSessions = allFiles
    .filter(
      (entry): entry is { fileName: string; sessionInfo: SessionInfo } =>
        entry.sessionInfo !== null,
    )
    .map((entry) => entry.sessionInfo);

  return validSessions;
};

/**
 * Utility class for session discovery and selection.
 */
export class SessionSelector {
  constructor(private config: Config) {}

  /**
   * Lists all available sessions for the current project.
   */
  async listSessions(): Promise<SessionInfo[]> {
    const chatsDir = path.join(
      this.config.storage.getProjectTempDir(),
      'chats',
    );
    return getSessionFiles(chatsDir, this.config.getSessionId());
  }

  /**
   * Finds a session by identifier (UUID or numeric index).
   *
   * @param identifier - Can be a full UUID or an index number (1-based)
   * @returns Promise resolving to the found SessionInfo
   * @throws Error if the session is not found or identifier is invalid
   */
  async findSession(identifier: string): Promise<SessionInfo> {
    const sessions = await this.listSessions();

    if (sessions.length === 0) {
      throw new Error('No previous sessions found for this project.');
    }

    // Sort by startTime (oldest first, so newest sessions get highest numbers)
    const sortedSessions = sessions.sort(
      (a, b) =>
        new Date(a.startTime ?? a.lastUpdated).getTime() -
        new Date(b.startTime ?? b.lastUpdated).getTime(),
    );

    // Try to find by UUID first
    const sessionByUuid = sortedSessions.find(
      (session) => session.id === identifier,
    );
    if (sessionByUuid) {
      return sessionByUuid;
    }

    // Parse as index number (1-based) - only allow numeric indexes
    const index = parseInt(identifier, 10);
    if (
      !isNaN(index) &&
      index.toString() === identifier &&
      index > 0 &&
      index <= sortedSessions.length
    ) {
      return sortedSessions[index - 1];
    }

    throw new Error(
      `Invalid session identifier "${identifier}". Use --list-sessions to see available sessions.`,
    );
  }

  /**
   * Resolves a resume argument to a specific session.
   *
   * @param resumeArg - Can be "latest", a full UUID, or an index number (1-based)
   * @returns Promise resolving to session selection result
   */
  async resolveSession(resumeArg: string): Promise<SessionSelectionResult> {
    let selectedSession: SessionInfo;

    if (resumeArg === RESUME_LATEST) {
      const sessions = await this.listSessions();

      if (sessions.length === 0) {
        throw new Error('No previous sessions found for this project.');
      }

      // Sort by startTime (oldest first, so newest sessions get highest numbers)
      sessions.sort(
        (a, b) =>
          new Date(a.startTime ?? a.lastUpdated).getTime() -
          new Date(b.startTime ?? b.lastUpdated).getTime(),
      );

      selectedSession = sessions[sessions.length - 1];
    } else {
      try {
        selectedSession = await this.findSession(resumeArg);
      } catch (error) {
        // Re-throw with more detailed message for resume command
        throw new Error(
          `Invalid session identifier "${resumeArg}". Use --list-sessions to see available sessions, then use --resume {number}, --resume {uuid}, or --resume latest.  Error: ${error}`,
        );
      }
    }

    return this.selectSession(selectedSession);
  }

  /**
   * Loads session data for a selected session.
   */
  private async selectSession(
    sessionInfo: SessionInfo,
  ): Promise<SessionSelectionResult> {
    const chatsDir = path.join(
      this.config.storage.getProjectTempDir(),
      'chats',
    );
    const sessionPath = path.join(chatsDir, sessionInfo.fileName);

    try {
      const sessionData: ConversationRecord = JSON.parse(
        await fs.readFile(sessionPath, 'utf8'),
      );

      return {
        sessionPath,
        sessionData,
      };
    } catch (error) {
      throw new Error(
        `Failed to load session ${sessionInfo.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
