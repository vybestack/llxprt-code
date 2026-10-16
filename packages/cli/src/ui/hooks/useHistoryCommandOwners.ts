/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import {
  createDiagnosticsCommand,
  type DiagnosticsCommandReads,
} from '../commands/diagnosticsCommand.js';
import { createPerfCommand } from '../commands/perfCommand.js';
import { createCopyCommand } from '../commands/copyCommand.js';
import { createCompressCommand } from '../commands/compressCommand.js';
import { bindCompressCommand } from '../commands/compressCommandHost.js';
import {
  createDumpcontextCommand,
  type DumpcontextCommandOperations,
} from '../commands/dumpcontextCommand.js';

type HistoryCommandOwners = Pick<
  BuiltinCommandOwners,
  | 'copyCommand'
  | 'compressCommand'
  | 'dumpcontextCommand'
  | 'restoreCommand'
  | 'perfCommand'
  | 'diagnosticsCommand'
>;
type PerfInputs = NonNullable<Parameters<typeof createPerfCommand>[0]>;

export function useHistoryCommandOwners(
  diagnostics: DiagnosticsCommandReads,
  snapshotCapability: PerfInputs['snapshotCapability'],
  tokenUsageDir: string | undefined,
  readRawHistory: NonNullable<PerfInputs['readHistory']>,
  readLatestAiOutput: Parameters<typeof createCopyCommand>[0],
  copyToClipboard: Parameters<typeof createCopyCommand>[1],
  compress: Agent['compress'] | null,
  dumpcontext: DumpcontextCommandOperations,
  restoreCommand: BuiltinCommandOwners['restoreCommand'],
): HistoryCommandOwners {
  return useMemo(
    () => ({
      diagnosticsCommand: createDiagnosticsCommand(diagnostics),
      perfCommand: createPerfCommand({
        snapshotCapability,
        tokenUsageDir,
        readHistory: readRawHistory,
      }),
      copyCommand: createCopyCommand(readLatestAiOutput, copyToClipboard),
      compressCommand: createCompressCommand(bindCompressCommand(compress)),
      dumpcontextCommand: createDumpcontextCommand(dumpcontext),
      restoreCommand,
    }),
    [
      diagnostics,
      snapshotCapability,
      tokenUsageDir,
      readRawHistory,
      readLatestAiOutput,
      copyToClipboard,
      compress,
      dumpcontext,
      restoreCommand,
    ],
  );
}
