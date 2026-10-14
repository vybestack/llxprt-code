/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { KeyedRowIndex } from '../../utils/keyed-row-index.js';

/** Where a tool_result block sits in the table. */
export interface ResultLocation {
  readonly message: number;
  readonly block: number;
}

function isLocation(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

/**
 * Which messages hold the tool_use and the tool_result of an id, on disk
 * (`use:<id>` and `res:<id>`), so a lookup is one keyed read and does not walk
 * the table. A tool_use id is expected once per history; a result id normally
 * has one location, and more only for duplicated ids, in which case the entry
 * for that id lists them all.
 */
export class ToolIdIndex {
  private constructor(private readonly keyed: KeyedRowIndex) {}

  static create(): ToolIdIndex {
    return new ToolIdIndex(KeyedRowIndex.create('anthropic-tool-ids'));
  }

  addUse(id: string, message: number): void {
    this.keyed.set(`use:${id}`, message);
  }

  hasUse(id: string): boolean {
    return this.keyed.has(`use:${id}`);
  }

  addResult(id: string, message: number, block: number): void {
    this.keyed.set(`res:${id}`, [
      ...this.results(id).map((location): [number, number] => [
        location.message,
        location.block,
      ]),
      [message, block],
    ]);
  }

  /** Whether the location was listed; a location is removed once. */
  removeResult(id: string, message: number, block: number): boolean {
    const locations = this.results(id);
    const kept = locations.filter(
      (location) => location.message !== message || location.block !== block,
    );
    if (kept.length === locations.length) return false;
    this.keyed.set(
      `res:${id}`,
      kept.map((location): [number, number] => [
        location.message,
        location.block,
      ]),
    );
    return true;
  }

  /** The listed locations of the result for `id`, in the order they were listed. */
  results(id: string): ResultLocation[] {
    const stored = this.keyed.get(`res:${id}`);
    if (stored === undefined) return [];
    if (!Array.isArray(stored))
      throw new Error('Tool id index holds a malformed result entry');
    return stored.map((location): ResultLocation => {
      if (!isLocation(location))
        throw new Error('Tool id index holds a malformed result location');
      return { message: location[0], block: location[1] };
    });
  }

  hasResult(id: string): boolean {
    return this.results(id).length > 0;
  }

  close(): void {
    this.keyed.close();
  }
}
