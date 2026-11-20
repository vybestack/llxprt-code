/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../packages/core/src/services/history/IContent.js';
import type {
  RequestMediaResolutionInput,
  RequestMediaResolver,
  ResolvedMediaRequest,
} from '../packages/core/src/storage/request-media-resolver.js';

export async function resolveMediaProbeHistory(
  rows: AsyncIterable<IContent>,
  resolver: RequestMediaResolver,
  input: Omit<RequestMediaResolutionInput, 'contents'>,
): Promise<ResolvedMediaRequest> {
  let resolved: ResolvedMediaRequest | undefined;
  try {
    for await (const row of rows) {
      if (resolved !== undefined)
        throw new Error('Media probe requires exactly one history row');
      resolved = await resolver.resolve({ ...input, contents: [row] });
    }
    if (resolved === undefined)
      throw new Error('Media probe requires exactly one history row');
    return resolved;
  } catch (error) {
    if (resolved !== undefined) {
      try {
        await resolved.release();
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          'Media probe resolution and cleanup failed',
        );
      }
    }
    throw error;
  }
}
