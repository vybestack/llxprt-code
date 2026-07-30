/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

interface TextSegment {
  readonly text: string;
  readonly level: number;
}

export interface PendingTextAppendResult {
  readonly publish: boolean;
  readonly text: string;
  readonly deltaCount: number;
}

export class PendingTextAccumulator {
  private segments: readonly TextSegment[] = [];
  private deltaCount = 0;

  constructor(private readonly publishInterval: number) {
    if (!Number.isInteger(publishInterval) || publishInterval < 1) {
      throw new Error('publishInterval must be a positive integer');
    }
  }

  append(delta: string): PendingTextAppendResult {
    this.deltaCount += 1;
    this.segments = appendSegment(this.segments, { text: delta, level: 0 });
    const publish =
      this.deltaCount % this.publishInterval === 0 || delta.includes('\n');
    const result: PendingTextAppendResult = {
      publish,
      text: publish ? this.materialize() : '',
      deltaCount: this.deltaCount,
    };
    if (publish) {
      this.deltaCount = 0;
    }
    return result;
  }

  replace(text: string): void {
    this.segments = text === '' ? [] : [{ text, level: 0 }];
    this.deltaCount = 0;
  }

  materialize(): string {
    return this.segments.map((segment) => segment.text).join('');
  }

  clear(): void {
    this.segments = [];
    this.deltaCount = 0;
  }
}

function appendSegment(
  segments: readonly TextSegment[],
  next: TextSegment,
): readonly TextSegment[] {
  if (segments.length === 0) {
    return [next];
  }
  const previous = segments[segments.length - 1];
  if (previous.level !== next.level) {
    return [...segments, next];
  }
  return appendSegment(segments.slice(0, -1), {
    text: previous.text + next.text,
    level: next.level + 1,
  });
}
