/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { join } from 'node:path';
import {
  getProjectHash,
  type ContinueTarget,
} from '@vybestack/llxprt-code-core';
import type { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { CliSessionPersistencePort } from '../../cliSessionPersistence.js';
import type { ResumeSessionReads } from '../hooks/commandRawResumeHost.js';
import type { resumeOwnerSession } from '../utils/resumeOwnerSession.js';
import { iContentToHistoryItems } from '../utils/iContentToHistoryItems.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import {
  type ResumeContext,
  type PerformResumeResult,
  type RecordingSwapCallbacks,
} from '../../services/performResume.js';

type BrowserResult = { ok: true } | { ok: false; error: string };
type BrowserResume = (target: ContinueTarget) => Promise<BrowserResult>;
type EmojiMode = Parameters<typeof iContentToHistoryItems>[1];

export function bindOwnerBrowserResume(
  resume: (target: ContinueTarget) => ReturnType<typeof resumeOwnerSession>,
  loadHistory: UseHistoryManagerReturn['loadHistory'],
  addItem: UseHistoryManagerReturn['addItem'],
  close: () => void,
): BrowserResume {
  return async (target) => {
    try {
      const replay = await resume(target);
      loadHistory([...replay.uiHistory]);
      for (const warning of replay.warnings)
        addItem({ type: 'info', text: `Warning: ${warning}` });
      close();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addItem({ type: 'error', text: message });
      return { ok: false, error: message };
    }
  };
}

export function bindRawBrowserResume(
  resume: ((target: ContinueTarget) => Promise<PerformResumeResult>) | null,
  readEmojiFilterMode: () => EmojiMode,
  clear: () => void,
  addItem: UseHistoryManagerReturn['addItem'],
  close: () => void,
  logger: DebugLogger,
): BrowserResume {
  return async (target) => {
    if (resume === null) {
      logger.warn(
        'Cannot resume session: recording infrastructure not available.',
      );
      return { ok: false, error: 'Recording infrastructure not available.' };
    }
    const result = await resume(target);
    if (!result.ok) {
      addItem({ type: 'error', text: result.error });
      return result;
    }
    const history = iContentToHistoryItems(
      result.history,
      readEmojiFilterMode(),
    );
    clear();
    history.forEach((item, index) => addItem(item, index));
    for (const warning of result.warnings)
      addItem({ type: 'info', text: `Warning: ${warning}` });
    close();
    return result;
  };
}

type BrowserSessionReads = ResumeSessionReads & {
  readonly sessionPersistence?: CliSessionPersistencePort;
};

export function bindRawBrowserSession(
  config: BrowserSessionReads,
  history: ResumeContext['history'],
  callbacks: RecordingSwapCallbacks | undefined,
  logger: DebugLogger,
): ((target: ContinueTarget) => Promise<PerformResumeResult>) | null {
  if (callbacks === undefined) return null;
  return (target) => {
    if (!config.sessionPersistence)
      throw new Error('CLI session persistence is unavailable');
    return config.sessionPersistence.resumeRecording(
      {
        type: 'perform_resume',
        sessionRef:
          target.kind === 'session'
            ? target.session.sessionId
            : target.checkpointId,
      },
      {
        chatsDir: join(config.projectTempDir, 'chats'),
        projectHash: getProjectHash(config.getProjectRoot()),
        currentSessionId: config.getSessionId(),
        currentProvider: config.getProvider() ?? 'unknown',
        currentModel: config.getModel(),
        workspaceDirs: [...config.directories()],
        recordingCallbacks: callbacks,
        history,
        adoptSessionId: (sessionId) => config.adoptSessionId(sessionId),
        logger,
      },
    );
  };
}
