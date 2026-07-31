/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PendingTextAppendResult {
  readonly publish: boolean;
  readonly text: string;
  readonly deltaCount: number;
}

export class PendingTextAccumulator {
  private text = '';

  constructor(private readonly publishInterval: number) {
    if (!Number.isInteger(publishInterval) || publishInterval < 1) {
      throw new Error('publishInterval must be a positive integer');
    }
  }

  append(delta: string): PendingTextAppendResult {
    this.text += delta;
    this.deltaCount += 1;
    const publish =
      this.deltaCount % this.publishInterval === 0 || delta.includes('\n');
    const result: PendingTextAppendResult = {
      publish,
      text: publish ? this.text : '',
      deltaCount: this.deltaCount,
    };
    if (publish) {
      this.deltaCount = 0;
    }
    return result;
  }

  replace(text: string): void {
    this.text = text;
  }

  materialize(): string {
    return this.text;
  }

  clear(): void {
    this.text = '';
    this.deltaCount = 0;
  }

  private deltaCount = 0;
}
