/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ToolIdStore } from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import type { KeyedRowIndex } from './keyed-row-index.js';

const MAPPED_PREFIX = 'tool-id:';
const USED_PREFIX = 'tool-id-used:';

/**
 * Tool id facts for the Kimi and Mistral mappers, kept in a request's
 * `KeyedRowIndex` so the heap holds no id per tool call. The index belongs to
 * the caller, who closes it when the request ends; the prefixes keep these keys
 * apart from other facts in the same index.
 */
export class KeyedRowToolIdStore implements ToolIdStore {
  constructor(private readonly index: KeyedRowIndex) {}

  getMappedId(callId: string): string | undefined {
    const value = this.index.get(`${MAPPED_PREFIX}${callId}`);
    return typeof value === 'string' ? value : undefined;
  }

  setMappedId(callId: string, mappedId: string): void {
    this.index.set(`${MAPPED_PREFIX}${callId}`, mappedId);
  }

  isUsed(mappedId: string): boolean {
    return this.index.has(`${USED_PREFIX}${mappedId}`);
  }

  markUsed(mappedId: string): void {
    this.index.set(`${USED_PREFIX}${mappedId}`, true);
  }
}
