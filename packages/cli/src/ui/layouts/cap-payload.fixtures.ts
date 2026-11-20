/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryItem } from '../types.js';
export function message(id: number, text = `MSG_${id}_END`): HistoryItem {
  return { id, type: 'gemini_content', text: `**${text}**` };
}
export function count(text: string, sentinel: string): number {
  return text.split(sentinel).length - 1;
}
export function serializedBytes(items: readonly HistoryItem[]): number {
  return items.reduce(
    (sum, item) => sum + Buffer.byteLength(JSON.stringify(item)),
    0,
  );
}
export function sizedMessage(
  id: number,
  bytes: number,
  multibyte = false,
): HistoryItem {
  const empty: HistoryItem = { id, type: 'gemini_content', text: '```\n\n```' };
  const budget = bytes - serializedBytes([empty]);
  const line = (multibyte ? '界' : 'x').repeat(20) + '\n';
  const lineBytes = Buffer.byteLength(line) + 1;
  return {
    ...empty,
    text:
      '```\n' +
      line.repeat(Math.floor(budget / lineBytes)) +
      'x'.repeat(budget % lineBytes) +
      '\n```',
  };
}
