/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { MediaReferenceBlock } from '../../../services/history/IContent.js';

/**
 * A reference straight from the media store with the origin admission stamps
 * (`media-admission-service.ts`); a dropped image keeps it as its reference.
 */
export async function withAdmittedOrigin(
  reference: Promise<MediaReferenceBlock>,
): Promise<MediaReferenceBlock> {
  return {
    ...(await reference),
    origin: { kind: 'pasted', readAt: '2026-11-20T10:00:00.000Z' },
  };
}
