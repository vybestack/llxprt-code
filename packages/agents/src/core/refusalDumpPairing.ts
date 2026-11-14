/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type {
  DumpAttemptContext,
  DumpAttemptOutcome,
} from '@vybestack/llxprt-code-providers';

export class RefusalDumpPairing {
  private readonly runtimeId = randomUUID();
  private readonly pendingPromptIds = new Set<string>();

  constructor(private readonly getAttemptIndex: () => number) {}

  createAttempt(promptId: string): DumpAttemptContext {
    const attempt: DumpAttemptContext = {
      promptId,
      attemptIndex: this.getAttemptIndex(),
      runtimeId: this.runtimeId,
      pairedSuccess: this.pendingPromptIds.has(promptId),
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
