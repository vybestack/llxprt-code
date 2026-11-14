/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { UnsupportedMediaEntry } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';

export class UnsupportedMediaSummary {
  private readonly sample: UnsupportedMediaEntry[] = [];
  private readonly counts = {
    image: 0,
    pdf: 0,
    audio: 0,
    video: 0,
    unknown: 0,
  };
  private total = 0;

  add(entry: UnsupportedMediaEntry): void {
    this.total++;
    const category = entry.mediaType;
    if (
      category === 'image' ||
      category === 'pdf' ||
      category === 'audio' ||
      category === 'video'
    ) {
      this.counts[category]++;
    } else this.counts.unknown++;
    if (this.sample.length < 8) this.sample.push(entry);
  }

  addAll(entries: readonly UnsupportedMediaEntry[]): void {
    for (const entry of entries) this.add(entry);
  }

  entries(): readonly UnsupportedMediaEntry[] {
    if (this.total <= this.sample.length) return [...this.sample];
    return [
      ...this.sample,
      {
        kind: 'unsupported',
        reason: `Unsupported media replaced with text placeholders: ${Object.entries(
          this.counts,
        )
          .map(([category, count]) => `${category}=${count}`)
          .join(
            ', ',
          )}; showing the first ${this.sample.length} of ${this.total} items`,
      },
    ];
  }
}
