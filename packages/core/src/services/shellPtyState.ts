/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IPty } from '@lydell/node-pty';
import type { Terminal } from '@xterm/headless';
import type { PtyImplementation } from '../utils/getPty.js';
import type {
  ShellOutputEvent,
  ShellExecutionConfig,
} from './shellExecutionTypes.js';
import type { ExitGuard } from './shellExitGuard.js';
import type { ActivePty } from './shellPtyHelpers.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';
import type { BoundedCombinedCollector } from '@vybestack/llxprt-code-tools/acquisition.js';

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
  output: string | AnsiOutput | null;
  /**
   * Bounded raw-byte collector replacing the unbounded outputChunks: Buffer[]
   * array (Issue #3200). Retains a bounded head/tail of PTY output for
   * rawOutput compatibility without full-size materialization.
   */
  rawCollector: BoundedCombinedCollector;
  error: Error | null;
  isStreamingRawContent: boolean;
  sniffedBytes: number;
  isWriting: boolean;
  hasStartedOutput: boolean;
  hasResolved: boolean;
  abortFinalizeTimeout: NodeJS.Timeout | null;
  processingChain: Promise<void>;
  /** Bytes queued for ordered xterm processing. */
  pendingQueueBytes: number;
  /** Queue entries are bounded separately because tiny chunks retain closures. */
  pendingQueueItems: number;
  /** Whether pause/resume provides real producer backpressure. */
  supportsBackpressure: boolean;
  backpressurePaused: boolean;
  queueOverflowed: boolean;
  /**
   * Maximum number of lines the xterm buffer can hold (scrollback + rows).
   * Used to detect scrollback eviction (Issue #3200 finding 3).
   */
  terminalMaxBufferLines: number;
  /** Configured xterm scrollback capacity, excluding visible rows. */
  terminalScrollbackCapacity: number;
  /** Whether xterm had already filled its scrollback before the latest scroll. */
  terminalScrollbackAtCapacity: boolean;
  /** True once the terminal scrollback has evicted earlier content. */
  terminalContentEvicted: boolean;
}
