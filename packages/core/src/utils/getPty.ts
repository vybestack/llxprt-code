/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Subset of the node-pty module API used by the shell execution service. */
import type { IPty } from '@lydell/node-pty';

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
  name: 'lydell-node-pty' | 'node-pty';
} | null;

export interface PtyProcess {
  readonly pid: number;
  onData(callback: (data: string) => void): void;
  onExit(callback: (e: { exitCode: number; signal?: number }) => void): void;
  kill(signal?: string): void;
}

export const getPty = async (): Promise<PtyImplementation> => {
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
