/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  checkpoint,
  type DiskCharacters,
  type Character,
} from './o200k-disk-io.js';

function prefix(character: Character): boolean {
  return (
    !character.kind.newline && !character.kind.letter && !character.kind.number
  );
}

function contraction(reader: DiskCharacters, start: number): number {
  const quote = reader.at(start);
  if (quote?.text !== "'") return start;
  const first = reader.at(quote.end);
  if (!first) return start;
  if (first.kind.foldS || ['t', 'm', 'd'].includes(first.text.toLowerCase()))
    return first.end;
  const second = reader.at(first.end);
  const pair = first.text.toLowerCase() + (second?.text.toLowerCase() ?? '');
  return second && ['re', 've', 'll'].includes(pair) ? second.end : start;
}

async function letterAlternative(
  reader: DiskCharacters,
  start: number,
  lowerRequired: boolean,
  signal?: AbortSignal,
): Promise<number> {
  let position = start;
  let upperCount = 0;
  let valid = start;
  let work = 0;
  let character = reader.at(position);
  while (character?.kind.upper === true) {
    position = character.end;
    upperCount++;
    if (!lowerRequired || character.kind.lower) valid = position;
    if (++work % 65536 === 0) await checkpoint(signal);
    character = reader.at(position);
  }
  if (!lowerRequired && upperCount === 0) return start;
  while (character?.kind.lower === true) {
    position = character.end;
    valid = position;
    if (++work % 65536 === 0) await checkpoint(signal);
    character = reader.at(position);
  }
  return valid > start ? contraction(reader, valid) : start;
}

async function letters(
  reader: DiskCharacters,
  start: number,
  signal?: AbortSignal,
): Promise<number> {
  const first = reader.at(start);
  if (!first) return start;
  for (const lowerRequired of [true, false]) {
    if (prefix(first)) {
      const end = await letterAlternative(
        reader,
        first.end,
        lowerRequired,
        signal,
      );
      if (end > first.end) return end;
    }
    const end = await letterAlternative(reader, start, lowerRequired, signal);
    if (end > start) return end;
  }
  return start;
}

function isPunctuation(
  character: Character | undefined,
): character is Character {
  return (
    character !== undefined &&
    !character.kind.space &&
    !character.kind.letter &&
    !character.kind.number
  );
}

function isSuffix(character: Character | undefined): character is Character {
  return (
    character !== undefined &&
    (character.kind.newline || character.text === '/')
  );
}

async function punctuation(
  reader: DiskCharacters,
  start: number,
  signal?: AbortSignal,
): Promise<number> {
  const first = reader.at(start);
  let position = first?.text === ' ' ? first.end : start;
  const beginning = position;
  let work = 0;
  let character = reader.at(position);
  while (isPunctuation(character)) {
    position = character.end;
    if (++work % 65536 === 0) await checkpoint(signal);
    character = reader.at(position);
  }
  if (position === beginning) return start;
  while (isSuffix(character)) {
    position = character.end;
    if (++work % 65536 === 0) await checkpoint(signal);
    character = reader.at(position);
  }
  return position;
}

async function whitespace(
  reader: DiskCharacters,
  start: number,
  signal?: AbortSignal,
): Promise<number> {
  let position = start;
  let lastNewline = start;
  let beforeLast = start;
  let work = 0;
  let character = reader.at(position);
  while (character?.kind.space === true) {
    beforeLast = position;
    position = character.end;
    if (character.kind.newline) lastNewline = position;
    if (++work % 65536 === 0) await checkpoint(signal);
    character = reader.at(position);
  }
  if (lastNewline > start) return lastNewline;
  if (character && beforeLast > start) return beforeLast;
  return position;
}

export async function nextPiece(
  reader: DiskCharacters,
  start: number,
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const letterEnd = await letters(reader, start, signal);
  if (letterEnd > start) return letterEnd;
  let position = start;
  for (let count = 0; count < 3; count++) {
    const character = reader.at(position);
    if (character?.kind.number !== true) break;
    position = character.end;
  }
  if (position > start) return position;
  const punctuationEnd = await punctuation(reader, start, signal);
  if (punctuationEnd > start) return punctuationEnd;
  const whitespaceEnd = await whitespace(reader, start, signal);
  if (whitespaceEnd > start) return whitespaceEnd;
  throw new Error(`Pinned regex failed to cover source byte ${start}`);
}
