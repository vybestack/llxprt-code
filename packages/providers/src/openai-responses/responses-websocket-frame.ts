/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/** Joins streamed frame bytes into one send buffer, failing past `maxBytes`. */
export async function assembleFrame(
  chunks: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of chunks) {
    total += chunk.length;
    if (total > maxBytes)
      throw new Error(
        `JSON request envelope exceeds ${maxBytes} bytes (${total}+ bytes)`,
      );
    parts.push(chunk);
  }
  const frame = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    frame.set(part, offset);
    offset += part.length;
  }
  return frame;
}
