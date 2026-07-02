/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IPty } from '@lydell/node-pty';
import type { Terminal } from '@xterm/headless';
import type { TextDecoder } from 'node:util';
import type { PtyImplementation } from '../utils/getPty.js';
import type {
  ShellOutputEvent,
  ShellExecutionConfig,
} from './shellExecutionTypes.js';
import type { ExitGuard } from './shellExitGuard.js';
import type { ActivePty } from './shellPtyHelpers.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';

/** State bag shared across PTY helper closures. */
export interface PtyExecState {
  ptyProcess: IPty;
  headlessTerminal: Terminal;
  activePtyEntry: ActivePty;
  isWindows: boolean;
  abortSignal: AbortSignal;
  onOutputEvent: (event: ShellOutputEvent) => void;
  shellExecutionConfig: ShellExecutionConfig;
  ptyInfo: NonNullable<PtyImplementation>;
  /**
   * Whether the PTY backend creates a detached process group, enabling
   * `process.kill(-pid)` to kill the entire tree. node-pty (forkpty → setsid)
   * does; Bun.Terminal does not (no new session/group).
   */
  supportsProcessGroupKill: boolean;
  inactivityAbortController: AbortController;
  resetInactivityTimer: () => void;
  exitedGuard: ExitGuard;
  decoder: TextDecoder | null;
  output: string | AnsiOutput | null;
  outputChunks: Buffer[];
  error: Error | null;
  isStreamingRawContent: boolean;
  sniffedBytes: number;
  isWriting: boolean;
  hasStartedOutput: boolean;
  hasResolved: boolean;
  abortFinalizeTimeout: NodeJS.Timeout | null;
  processingChain: Promise<void>;
}
