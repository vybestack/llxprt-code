/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export function kimiSafeCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError('Kimi count must be a nonnegative safe integer');
  return value;
}

export function kimiDigitRange(first: number, count: number): number {
  kimiSafeCount(first);
  kimiSafeCount(count);
  const end = kimiSafeCount(first + count);
  let at = first;
  let width = String(first).length;
  let next = 10 ** width;
  let total = 0;
  while (at < end) {
    const boundary = Math.min(end, next);
    total = kimiSafeCount(total + (boundary - at) * width);
    at = boundary;
    width++;
    next *= 10;
  }
  return total;
}
