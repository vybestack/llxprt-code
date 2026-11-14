/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export function base64Code(code: number): boolean {
  const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  const digit = code >= 48 && code <= 57;
  if (letter || digit) return true;
  return code === 43 || code === 47 || code === 61;
}

export function dataHeader(
  value: string,
  start: number,
): { payload: number; image: boolean } | undefined {
  const code = value.charCodeAt(start);
  if (code !== 68 && code !== 100) return undefined;
  if (value.slice(start, start + 5).toLowerCase() !== 'data:') return undefined;
  let firstSemicolon = -1;
  let lastSemicolon = -1;
  let end = start + 5;
  while (end < value.length && value.charCodeAt(end) !== 44) {
    if (value.charCodeAt(end) === 59) {
      if (firstSemicolon === -1) firstSemicolon = end;
      lastSemicolon = end;
    }
    end++;
  }
  if (end === value.length || lastSemicolon === -1 || end - lastSemicolon !== 7)
    return undefined;
  if (
    value.slice(lastSemicolon + 1, end).toLowerCase() !== 'base64' ||
    !base64Code(value.charCodeAt(end + 1))
  )
    return undefined;
  return {
    payload: end + 1,
    image:
      firstSemicolon - start >= 11 &&
      value.slice(start + 5, start + 11).toLowerCase() === 'image/',
  };
}
