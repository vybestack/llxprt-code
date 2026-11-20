/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export async function countSimpleTextStream(
  parts: AsyncIterable<Uint8Array>,
): Promise<number> {
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  let characters = 0;
  let runs = 0;
  let whitespace = false;
  const append = (text: string): void => {
    characters += text.length;
    for (const value of text) {
      const next = /\s/u.test(value);
      if (next && !whitespace) runs++;
      whitespace = next;
    }
  };
  for await (const part of parts)
    append(decoder.decode(part, { stream: true }));
  append(decoder.decode());
  return characters === 0
    ? 0
    : Math.round(Math.max((runs + 1) * 1.3, characters / 4));
}
