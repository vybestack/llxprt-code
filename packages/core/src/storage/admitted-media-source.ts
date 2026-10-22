/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import { HistoryReaderScope } from '../services/history/historyReaderScope.js';
import type { LocalMediaStore } from './local-media-store.js';

const sources = new WeakMap<MediaReferenceBlock, AdmittedMediaSource>();
const reservations = new WeakMap<
  LocalMediaStore,
  Map<string, Set<AdmittedMediaSource>>
>();

export async function closeAdmissionReservation(
  store: LocalMediaStore,
  contentId: string,
  ownerId: string,
): Promise<void> {
  const held = reservations.get(store);
  const key = `${ownerId}\u0000${contentId}`;
  const owners = held?.get(key);
  if (owners === undefined) return;
  held?.delete(key);
  for (const source of owners) await source.close();
}

export class AdmittedMediaSource {
  private readonly readers = new HistoryReaderScope(
    'Media admission source is closed',
  );
  private closed = false;

  constructor(
    private readonly store: LocalMediaStore,
    private readonly contentId: string,
    private readonly originalContentId: string,
  ) {}

  allows(store: LocalMediaStore): boolean {
    return !this.closed && store === this.store;
  }

  read(reference: MediaReferenceBlock): Promise<Uint8Array> {
    this.readers.requireOpen();
    return this.readers.read(() => this.store.readReserved(reference));
  }

  capture(reference: MediaReferenceBlock): void {
    if (
      reference.contentId !== this.contentId ||
      reference.originalObject.contentId !== this.originalContentId
    )
      throw new Error('Media admission source does not own this reference');
    Object.freeze(reference.selectedObject);
    Object.freeze(reference.originalObject);
    Object.freeze(reference);
    sources.set(reference, this);
  }

  close(): Promise<void> {
    this.closed = true;
    return this.readers.close();
  }
}

export function admittedMediaSource(
  reference: MediaReferenceBlock,
): AdmittedMediaSource | undefined {
  return sources.get(reference);
}

export function captureAdmittedMediaSource(
  reference: MediaReferenceBlock,
  store: LocalMediaStore,
  ownerId: string,
): MediaReferenceBlock {
  const captured = { ...reference };
  const source = new AdmittedMediaSource(
    store,
    reference.contentId,
    reference.originalObject.contentId,
  );
  source.capture(captured);
  let held = reservations.get(store);
  if (held === undefined) {
    held = new Map();
    reservations.set(store, held);
  }
  const key = `${ownerId}\u0000${reference.contentId}`;
  let owners = held.get(key);
  if (owners === undefined) {
    owners = new Set();
    held.set(key, owners);
  }
  owners.add(source);
  return captured;
}

export async function closeAdmittedMediaSources(
  contents: readonly IContent[],
): Promise<void> {
  for (const row of contents)
    for (const block of row.blocks) {
      if (block.type === 'media' && block.encoding === 'reference')
        await sources.get(block)?.close();
    }
}
