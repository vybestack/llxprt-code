/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalStore } from '../journal/journalStore.js';
import type { VersionEdit } from '../journal/groupEdits.js';
import type { LocalMediaStore } from './local-media-store.js';
import { historyOwnerIdFor } from './media-admission-service.js';

export interface PinnedMediaLease {
  readonly origin: 'native-history';
  requireOpen(): void;
  withRead<T>(consume: () => Promise<T>): Promise<T>;
}

function scalar(bytes: Uint8Array | undefined): number {
  if (bytes === undefined) return 0;
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid deferred history media queue counter');
  return value;
}

function state(key: string, value: unknown): VersionEdit {
  return { kind: 'setState', key, value: Buffer.from(JSON.stringify(value)) };
}

function entry(bytes: Uint8Array | undefined): {
  contentId: string;
  version: number;
} {
  if (bytes === undefined)
    throw new Error('Missing deferred history media release');
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof value !== 'object' || value === null)
    throw new Error('Invalid deferred history media release');
  if (!('contentId' in value) || !('version' in value))
    throw new Error('Invalid deferred history media release');
  if (typeof value.contentId !== 'string' || typeof value.version !== 'number')
    throw new Error('Invalid deferred history media release');
  if (!Number.isSafeInteger(value.version) || value.version < 0)
    throw new Error('Invalid deferred history media release');
  return { contentId: value.contentId, version: value.version };
}

export class HistoryMediaReleaseGate {
  private head = 0;
  private tail = 0;
  private busy = false;
  private serial: Promise<void> = Promise.resolve();

  constructor(
    private readonly journal: JournalStore,
    private readonly media: LocalMediaStore,
    private readonly owns: (contentId: string) => boolean,
  ) {}

  async open(): Promise<void> {
    this.head = scalar(await this.journal.getState('rel:head'));
    this.tail = scalar(await this.journal.getState('rel:tail'));
    if (this.head > this.tail)
      throw new Error('Invalid deferred history media queue bounds');
    this.journal.mediaPins.bind(
      () => {
        if (this.busy || this.head === this.tail) return undefined;
        return this.run(() => this.drain());
      },
      () => this.busy || this.head !== this.tail,
    );
    await this.run(() => this.drain());
  }

  pendingCount(): Promise<number> {
    return this.serial.then(() => this.tail - this.head);
  }

  release(contentId: string): Promise<void> {
    return this.run(async () => {
      const version = (this.journal.published?.commitSeq ?? 0) + 1;
      if (this.journal.mediaPins.oldestVersion === undefined) {
        await this.media.release(contentId, historyOwnerIdFor(contentId));
        return;
      }
      await this.journal.commit([
        state(`rel:${this.tail}`, { contentId, version }),
        state('rel:head', this.head),
        state('rel:tail', this.tail + 1),
      ]);
      this.tail++;
    });
  }

  settle(): Promise<void> {
    return this.run(() => this.drain());
  }

  private run(work: () => Promise<void>): Promise<void> {
    const turn = this.serial.then(async () => {
      this.busy = true;
      try {
        await work();
      } finally {
        this.busy = false;
      }
    });
    this.serial = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  private async drain(): Promise<void> {
    while (this.head < this.tail) {
      const held = entry(await this.journal.getState(`rel:${this.head}`));
      const oldest = this.journal.mediaPins.oldestVersion;
      if (oldest !== undefined && held.version > oldest) return;
      if (!this.owns(held.contentId))
        await this.media.release(
          held.contentId,
          historyOwnerIdFor(held.contentId),
        );
      await this.journal.commit([
        state(`rel:${this.head}`, null),
        state('rel:head', this.head + 1),
      ]);
      this.head++;
    }
  }
}
