/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export class StreamJsonString {
  constructor(readonly chunks: () => AsyncIterable<string>) {}
}
export async function* quotedChunks(
  value: StreamJsonString,
): AsyncIterable<string> {
  yield '"';
  let pending = '';
  for await (const original of value.chunks()) {
    let chunk = pending + original;
    pending = '';
    const last = chunk.charCodeAt(chunk.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) {
      pending = chunk.slice(-1);
      chunk = chunk.slice(0, -1);
    }
    yield JSON.stringify(chunk).slice(1, -1);
  }
  if (pending !== '') yield JSON.stringify(pending).slice(1, -1);
  yield '"';
}
