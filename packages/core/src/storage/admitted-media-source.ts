/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import { HistoryReaderScope } from '../services/history/historyReaderScope.js';
import type { LocalMediaStore } from './local-media-store.js';

const admissionSource = Symbol('admitted-media-source');

export class AdmissionSourceReservations {
  private readonly held = new Map<string, Set<AdmittedMediaSource>>();

  retain(
    contentId: string,
    ownerId: string,
    source: AdmittedMediaSource,
  ): void {
    const key = `${ownerId}\u0000${contentId}`;
    let owners = this.held.get(key);
    if (owners === undefined) {
      owners = new Set();
      this.held.set(key, owners);
    }
    owners.add(source);
  }

  async close(contentId: string, ownerId: string): Promise<void> {
    const key = `${ownerId}\u0000${contentId}`;
    const owners = this.held.get(key);
    if (owners === undefined) return;
    this.held.delete(key);
    for (const source of owners) await source.close();
  }
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
    Object.defineProperty(reference, admissionSource, { value: this });
    Object.freeze(reference.selectedObject);
    Object.freeze(reference.originalObject);
    Object.freeze(reference);
  }

  close(): Promise<void> {
    this.closed = true;
    return this.readers.close();
  }
}

export function admittedMediaSource(
  reference: MediaReferenceBlock,
): AdmittedMediaSource | undefined {
  return admissionSource in reference &&
    reference[admissionSource] instanceof AdmittedMediaSource
    ? reference[admissionSource]
    : undefined;
}

export function captureAdmittedMediaSource(
  reference: MediaReferenceBlock,
  store: LocalMediaStore,
  ownerId: string,
): MediaReferenceBlock {
  const source = new AdmittedMediaSource(
    store,
    reference.contentId,
    reference.originalObject.contentId,
  );
  const captured = { ...reference };
  source.capture(captured);
  store.admissionSources.retain(reference.contentId, ownerId, source);
  return captured;
}

export async function closeAdmittedMediaSources(
  contents: readonly IContent[],
): Promise<void> {
  for (const row of contents)
    for (const block of row.blocks) {
      if (block.type === 'media' && block.encoding === 'reference')
        await admittedMediaSource(block)?.close();
    }
}
