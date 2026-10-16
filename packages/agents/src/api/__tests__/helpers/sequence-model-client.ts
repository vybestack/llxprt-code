/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { AgentClient } from '../../../core/client.js';

export class SequenceModelClient extends AgentClient {
  sequenceModel: string | null = null;

  override getCurrentSequenceModel(): string | null {
    return this.sequenceModel;
  }
}
