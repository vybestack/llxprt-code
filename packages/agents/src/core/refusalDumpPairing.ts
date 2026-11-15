/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import {
  DumpRetentionCoordinator,
  type DumpAttemptContext,
  type DumpAttemptOutcome,
} from '@vybestack/llxprt-code-providers';

export class RefusalDumpPairing {
  private readonly runtimeId = randomUUID();
  private readonly pendingPromptIds = new Set<string>();

  constructor(
    private readonly getAttemptIndex: () => number,
    private readonly retentionCoordinator = new DumpRetentionCoordinator(),
  ) {}

  createAttempt(
    promptId: string,
    attemptIndex = this.getAttemptIndex(),
  ): DumpAttemptContext {
    const attempt: DumpAttemptContext = {
      promptId,
      attemptIndex,
      runtimeId: this.runtimeId,
      pairedSuccess: this.pendingPromptIds.has(promptId),
      retentionCoordinator: this.retentionCoordinator,
      recordDump: (outcome: DumpAttemptOutcome, baseId: string): void => {
        attempt.dumpBaseId = baseId;
        if (outcome === 'refusal') this.pendingPromptIds.add(promptId);
        if (outcome === 'paired-success')
          this.pendingPromptIds.delete(promptId);
      },
    };
    return attempt;
  }
}
