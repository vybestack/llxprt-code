/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

export type UnsupportedSourceShapeClassification =
  | 'tool'
  | 'media'
  | 'mixed'
  | 'non-text';

export class UnsupportedSourceRequestShapeError extends Error {
  constructor(
    readonly classification: UnsupportedSourceShapeClassification,
    readonly rowIndex: number,
  ) {
    super(
      `Unsupported disk source request shape: ${classification} at row ${rowIndex}; only normalized TEXT rows have exact bounded attribution`,
    );
    this.name = 'UnsupportedSourceRequestShapeError';
  }
}

function classification(
  content: IContent,
): UnsupportedSourceShapeClassification | undefined {
  const types = new Set(content.blocks.map((block) => block.type));
  if (types.size === 0 || (types.size === 1 && types.has('text')))
    return undefined;
  if (types.size > 1) return 'mixed';
  if (types.has('media')) return 'media';
  if (types.has('tool_call') || types.has('tool_response')) return 'tool';
  return 'non-text';
}

export async function assertSupportedTextSource(
  rows: ProviderRequestRows,
  signal?: AbortSignal,
): Promise<void> {
  let rowIndex = 0;
  const reader = rows.openReader(signal);
  try {
    while (await admitSourceRow(reader, rowIndex, signal)) rowIndex++;
  } finally {
    await reader.return();
  }
  signal?.throwIfAborted();
}

function admitSourceRow(
  reader: AsyncGenerator<IContent, void, unknown>,
  rowIndex: number,
  signal?: AbortSignal,
): Promise<boolean> {
  return reader.next().then((next) => {
    signal?.throwIfAborted();
    if (next.done === true) return false;
    const unsupported = classification(next.value);
    if (unsupported !== undefined)
      throw new UnsupportedSourceRequestShapeError(unsupported, rowIndex);
    return true;
  });
}
