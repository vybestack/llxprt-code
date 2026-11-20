/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent, ResumeBootHandle } from '@vybestack/llxprt-code-core';

export async function collectResumeRows(
  rows: AsyncIterable<IContent> | Iterable<IContent>,
): Promise<IContent[]> {
  const contents: IContent[] = [];
  for await (const row of rows) contents.push(row);
  return contents;
}

export function displayBoot(
  rows: readonly IContent[],
): Pick<ResumeBootHandle, 'streamRows'> {
  return {
    async *streamRows() {
      yield* rows;
    },
  };
}
