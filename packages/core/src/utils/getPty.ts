/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Subset of the node-pty module API used by the shell execution service. */
import type { IPty } from '@lydell/node-pty';
import type { PtyExecutionMethod } from '../services/shellExecutionTypes.js';
import { isBunPosix } from './runtime.js';
import { createBunPty } from './bunPtyAdapter.js';

export interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      cwd?: string;
      name?: string;
      cols?: number;
      rows?: number;
      env?: Record<string, string | undefined>;
      handleFlowControl?: boolean;
    },
  ): IPty;
}

export type PtyImplementation = {
  module: PtyModule;
  name: PtyExecutionMethod;
} | null;

export interface PtyProcess {
  readonly pid: number;
  onData(callback: (data: string) => void): void;
  onExit(callback: (e: { exitCode: number; signal?: number }) => void): void;
  kill(signal?: string): void;
}

/**
 * Resolve the PTY implementation for the current runtime.
 *
 * - **Bun + POSIX**: a `Bun.Terminal` adapter (`bun-pty`). `@lydell/node-pty`
 *   silently hangs under Bun POSIX (oven-sh/bun#25822), so it is bypassed.
 * - **Node / Windows**: `@lydell/node-pty` (preferred) with a `node-pty`
 *   fallback.
 */
export const getPty = async (): Promise<PtyImplementation> => {
  if (isBunPosix()) {
    return {
      module: {
        spawn: (file, args, options) => createBunPty(file, args, options),
      },
      name: 'bun-pty',
    };
  }

  try {
    const lydell = '@lydell/node-pty';
    const module = await import(lydell);
    return { module, name: 'lydell-node-pty' };
  } catch {
    // Probe for alternative node-pty implementation
    try {
      const nodePty = 'node-pty';
      const module = await import(nodePty);
      return { module, name: 'node-pty' };
    } catch {
      // No node-pty implementation available
      return null;
    }
  }
};
