/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { requestScopedContents } from '../../utils/requestScopedBody.js';
import {
  cancellableSerialization,
  withSerializationCleanup,
  type ResponsesSerialization,
} from '../responses-serialization-lifecycle.js';

export function readOwnedSource(
  contents: AsyncIterable<IContent>,
  signal?: AbortSignal,
): ResponsesSerialization<number> {
  const owner = requestScopedContents(contents, signal);
  return cancellableSerialization(
    () =>
      withSerializationCleanup(
        async () => {
          let count = 0;
          for await (const _row of owner.stream()) count++;
          return count;
        },
        () => owner.dispose(),
      ),
    async () => {},
    signal,
  );
}
