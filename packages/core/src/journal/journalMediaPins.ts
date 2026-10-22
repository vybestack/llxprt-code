/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export class JournalMediaPins {
  private readonly versions = new Map<number, number>();
  private releaseHandler: (() => void | Promise<void>) | undefined;
  private pending: (() => boolean) | undefined;

  get hasOwner(): boolean {
    return this.releaseHandler !== undefined;
  }

  get oldestVersion(): number | undefined {
    return this.versions.keys().next().value;
  }

  get releasePending(): boolean {
    return this.pending?.() === true;
  }

  bind(handler: () => void | Promise<void>, pending: () => boolean): void {
    if (this.releaseHandler !== undefined)
      throw new Error('Journal media release gate is already installed');
    this.releaseHandler = handler;
    this.pending = pending;
  }

  retain(version: number): () => void {
    this.versions.set(version, (this.versions.get(version) ?? 0) + 1);
    return () => {
      const count = this.versions.get(version);
      if (count === undefined)
        throw new Error('Journal pin version is missing');
      if (count === 1) this.versions.delete(version);
      else this.versions.set(version, count - 1);
    };
  }

  afterReaderRelease(
    release: () => void | Promise<void>,
  ): void | Promise<void> {
    const drain = this.releaseHandler;
    return drain === undefined ? release() : this.retire(release, drain);
  }

  private async retire(
    release: () => void | Promise<void>,
    drain: () => void | Promise<void>,
  ): Promise<void> {
    const failures: unknown[] = [];
    for (const close of [release, drain]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Journal media pin retirement failed');
  }
}
