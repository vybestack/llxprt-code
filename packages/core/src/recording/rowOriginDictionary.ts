/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Maps the persisted origin ids found on journal lines to the small integers a
 * directory row stores. It holds one entry per distinct origin, so it stays
 * small however long the history is.
 */
export class RowOriginDictionary {
  private readonly ids = new Map<string, number>();
  private readonly names: string[] = [];

  /** The dictionary id of an origin; 0 stands for no origin. */
  idOf(origin: string | undefined): number {
    if (origin === undefined) return 0;
    const known = this.ids.get(origin);
    if (known !== undefined) return known;
    this.names.push(origin);
    this.ids.set(origin, this.names.length);
    return this.names.length;
  }

  originOf(id: number | undefined): string | undefined {
    if (id === undefined) return undefined;
    if (id < 1 || id > this.names.length)
      throw new Error(`Row origin dictionary has no origin ${id}`);
    return this.names[id - 1];
  }
}
