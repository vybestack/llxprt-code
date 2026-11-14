/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  RequestMediaResolver,
  type RequestMediaResolutionInput,
  type ResolvedMediaRequest,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';

export class ContinuationRowObserver extends RequestMediaResolver {
  private readonly rows: Array<WeakRef<IContent>> = [];
  acquired = 0;
  peakRows = 0;
  peakTextBytes = 0;

  override resolve(
    input: RequestMediaResolutionInput,
  ): Promise<ResolvedMediaRequest> {
    for (const row of input.contents) {
      this.acquired++;
      this.rows.push(new WeakRef(row));
    }
    return this.observe(super.resolve(input));
  }

  private async observe(
    pending: Promise<ResolvedMediaRequest>,
  ): Promise<ResolvedMediaRequest> {
    const resolved = await pending;
    try {
      await this.sample();
      return resolved;
    } catch (error) {
      await resolved.release();
      throw error;
    }
  }

  async sample(): Promise<{ rows: number; textBytes: number }> {
    await Bun.sleep(0);
    gcAndSweep();
    return this.count();
  }

  private count(): { rows: number; textBytes: number } {
    let rows = 0;
    let textBytes = 0;
    for (const reference of this.rows) {
      const row = reference.deref();
      if (row === undefined) continue;
      rows++;
      for (const block of row.blocks)
        if (block.type === 'text') textBytes += Buffer.byteLength(block.text);
    }
    this.peakRows = Math.max(this.peakRows, rows);
    this.peakTextBytes = Math.max(this.peakTextBytes, textBytes);
    expect(rows).toBeLessThanOrEqual(2);
    expect(textBytes).toBeLessThanOrEqual(2 * 64 * 1024);
    return { rows, textBytes };
  }
}
