/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export async function providerStreamError(
  stream: AsyncIterable<IContent>,
): Promise<unknown> {
  try {
    for await (const content of stream) void content;
    return undefined;
  } catch (error) {
    return error;
  }
}
