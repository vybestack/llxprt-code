/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

function endOfString(text: string, start: number): number {
  let at = start + 1;
  while (text[at] !== '"') at += text[at] === '\\' ? 2 : 1;
  return at + 1;
}

function endOfContainer(text: string, start: number): number {
  let depth = 0;
  for (let at = start; at < text.length; at += 1) {
    const char = text[at];
    if (char === '"') {
      at = endOfString(text, at) - 1;
    } else if (char === '{' || char === '[') {
      depth += 1;
    } else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
  }
  throw new Error('unterminated JSON container');
}

function endOfValue(text: string, start: number): number {
  const first = text[start];
  if (first === '"') return endOfString(text, start);
  if (first === '{' || first === '[') return endOfContainer(text, start);
  let at = start;
  while (at < text.length && text[at] !== ',' && text[at] !== '}') at += 1;
  return at;
}

/**
 * The raw text of the top-level member `key` of a JSON object text, without
 * parsing or re-serializing the rest of the body.
 */
export function topLevelMember(body: string, key: string): string | undefined {
  if (body[0] !== '{') throw new Error('request body is not a JSON object');
  let at = 1;
  while (at < body.length && body[at] !== '}') {
    if (body[at] === ',') at += 1;
    const keyEnd = endOfString(body, at);
    const name: unknown = JSON.parse(body.slice(at, keyEnd));
    const valueStart = keyEnd + 1;
    const valueEnd = endOfValue(body, valueStart);
    if (name === key) return body.slice(valueStart, valueEnd);
    at = valueEnd;
  }
  return undefined;
}
