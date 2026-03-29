/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ideContext, type IdeContext, type File } from '../ide/ideContext.js';
import { DebugLogger } from '../debug/index.js';
import type { Config } from '../config/config.js';

/**
 * Tracks IDE context state and computes full vs incremental deltas
 * for injecting editor state into model turns.
 */
export class IdeContextTracker {
  private lastSentIdeContext: IdeContext | undefined;
  private forceFullIdeContext = true;

  private readonly logger: DebugLogger;
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
    this.logger = new DebugLogger('llxprt:core:ideContextTracker');
  }

  /**
   * Forces the next call to getContextParts to return a full context snapshot.
   */
  resetContext(): void {
    this.forceFullIdeContext = true;
  }

  /**
   * Returns the context parts (full or incremental delta) based on current state.
   * Also returns the new IDE context so the caller can store it for diffing.
   */
  getContextParts(forceFullContext: boolean): {
    contextParts: string[];
    newIdeContext: IdeContext | undefined;
  } {
    const shouldSendFull = forceFullContext || this.forceFullIdeContext;
    if (shouldSendFull || this.lastSentIdeContext == null) {
      return this.buildFullContext();
    }
    return this.buildIncrementalDelta();
  }

  /**
   * Builds the complete IDE context (all open files, active file, cursor, selection).
   */
  buildFullContext(): {
    contextParts: string[];
    newIdeContext: IdeContext | undefined;
  } {
    const currentIdeContext = ideContext.getIdeContext();
    if (currentIdeContext == null) {
      return { contextParts: [], newIdeContext: undefined };
    }

    const openFiles = currentIdeContext.workspaceState?.openFiles || [];
    const activeFile = openFiles.find((f) => f.isActive);
    const otherOpenFiles = openFiles
      .filter((f) => !f.isActive)
      .map((f) => f.path);

    const contextData: Record<string, unknown> = {};

    if (activeFile != null) {
      contextData.activeFile = {
        path: activeFile.path,
        cursor:
          activeFile.cursor != null
            ? {
                line: activeFile.cursor.line,
                character: activeFile.cursor.character,
              }
            : undefined,
        selectedText: activeFile.selectedText || undefined,
      };
    }

    if (otherOpenFiles.length > 0) {
      contextData.otherOpenFiles = otherOpenFiles;
    }

    if (Object.keys(contextData).length === 0) {
      return { contextParts: [], newIdeContext: currentIdeContext };
    }

    const jsonString = JSON.stringify(contextData, null, 2);
    const contextParts = [
      "Here is the user's editor context as a JSON object. This is for your information only.",
      '```json',
      jsonString,
      '```',
    ];

    if (this.config.getDebugMode()) {
      this.logger.debug(() => 'IDE Context:', {
        context: contextParts.join('\n'),
      });
    }

    return { contextParts, newIdeContext: currentIdeContext };
  }

  /**
   * Computes what changed in the IDE context since the last call.
   */
  buildIncrementalDelta(): {
    contextParts: string[];
    newIdeContext: IdeContext | undefined;
  } {
    const currentIdeContext = ideContext.getIdeContext();
    if (currentIdeContext == null || this.lastSentIdeContext == null) {
      return { contextParts: [], newIdeContext: currentIdeContext };
    }

    const delta: Record<string, unknown> = {};
    const changes: Record<string, unknown> = {};

    const lastFiles = new Map(
      (this.lastSentIdeContext.workspaceState?.openFiles || []).map(
        (f: File) => [f.path, f],
      ),
    );
    const currentFiles = new Map(
      (currentIdeContext.workspaceState?.openFiles || []).map((f: File) => [
        f.path,
        f,
      ]),
    );

    const openedFiles: string[] = [];
    for (const [path] of currentFiles.entries()) {
      if (!lastFiles.has(path)) {
        openedFiles.push(path);
      }
    }
    if (openedFiles.length > 0) {
      changes.filesOpened = openedFiles;
    }

    const closedFiles: string[] = [];
    for (const [path] of lastFiles.entries()) {
      if (!currentFiles.has(path)) {
        closedFiles.push(path);
      }
    }
    if (closedFiles.length > 0) {
      changes.filesClosed = closedFiles;
    }

    this.detectActiveFileChanges(
      currentIdeContext,
      this.lastSentIdeContext,
      changes,
    );

    if (Object.keys(changes).length === 0) {
      return { contextParts: [], newIdeContext: currentIdeContext };
    }

    delta.changes = changes;
    const jsonString = JSON.stringify(delta, null, 2);
    const contextParts = [
      "Here is a summary of changes in the user's editor context, in JSON format. This is for your information only.",
      '```json',
      jsonString,
      '```',
    ];

    if (this.config.getDebugMode()) {
      this.logger.debug(() => 'IDE Context:', {
        context: contextParts.join('\n'),
      });
    }

    return { contextParts, newIdeContext: currentIdeContext };
  }

  /**
   * Detects and records changes to the active file (path, cursor, selection).
   */
  private detectActiveFileChanges(
    currentIdeContext: IdeContext,
    lastIdeContext: IdeContext,
    changes: Record<string, unknown>,
  ): void {
    const lastActiveFile = (
      lastIdeContext.workspaceState?.openFiles || []
    ).find((f: File) => f.isActive);
    const currentActiveFile = (
      currentIdeContext.workspaceState?.openFiles || []
    ).find((f: File) => f.isActive);

    if (currentActiveFile != null) {
      if (
        lastActiveFile == null ||
        lastActiveFile.path !== currentActiveFile.path
      ) {
        changes.activeFileChanged = {
          path: currentActiveFile.path,
          cursor:
            currentActiveFile.cursor != null
              ? {
                  line: currentActiveFile.cursor.line,
                  character: currentActiveFile.cursor.character,
                }
              : undefined,
          selectedText: currentActiveFile.selectedText || undefined,
        };
      } else {
        this.detectCursorAndSelectionChanges(
          currentActiveFile,
          lastActiveFile,
          changes,
        );
      }
    } else if (lastActiveFile != null) {
      changes.activeFileChanged = {
        path: null,
        previousPath: lastActiveFile.path,
      };
    }
  }

  /**
   * Detects cursor and selection changes for the same active file.
   */
  private detectCursorAndSelectionChanges(
    currentActiveFile: File,
    lastActiveFile: File,
    changes: Record<string, unknown>,
  ): void {
    const lastCursor = lastActiveFile.cursor;
    const currentCursor = currentActiveFile.cursor;
    if (
      currentCursor != null &&
      (lastCursor == null ||
        lastCursor.line !== currentCursor.line ||
        lastCursor.character !== currentCursor.character)
    ) {
      changes.cursorMoved = {
        path: currentActiveFile.path,
        cursor: {
          line: currentCursor.line,
          character: currentCursor.character,
        },
      };
    } else if (currentCursor == null && lastCursor != null) {
      changes.cursorMoved = {
        path: currentActiveFile.path,
        cursor: null,
      };
    }

    const lastSelectedText = lastActiveFile.selectedText || '';
    const currentSelectedText = currentActiveFile.selectedText || '';
    if (lastSelectedText !== currentSelectedText) {
      changes.selectionChanged = {
        path: currentActiveFile.path,
        selectedText: currentSelectedText,
      };
    }
  }

  /**
   * Records the IDE context that was last sent so the next call can compute a delta.
   */
  recordSentContext(ideCtx: IdeContext | undefined): void {
    this.lastSentIdeContext = ideCtx;
    this.forceFullIdeContext = false;
  }
}
