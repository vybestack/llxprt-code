/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ModelOutput } from '../llm-types/modelEnvelope.js';

/** Completion of a journaled send. Response payloads are read from the journal, never returned here. */
export interface TurnReceipt {
  readonly status: 'published' | 'empty';
  readonly promptId: string;
  readonly turnId: string;
  readonly responseId?: string;
  readonly finishReason?: ModelOutput['finishReason'];
  readonly rawStopReason?: string;
  readonly usage?: ModelOutput['usage'];
}
