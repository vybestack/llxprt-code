/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import * as path from 'node:path';

const DESIGN_DOC = path.resolve(
  import.meta.dir,
  '../../../../../../project-plans/issue854/journal-db-design.md',
);

let cachedLines: readonly string[] | undefined;

function designLines(): readonly string[] {
  cachedLines ??= fs.readFileSync(DESIGN_DOC, 'utf8').split('\n');
  return cachedLines;
}

/**
 * The cell text of every data row of the markdown table under the
 * `#### <heading>` line of the design document. Throws when the heading or its
 * table is missing, so a renamed heading fails the test that depends on it.
 */
export function designTable(heading: string): string[][] {
  const lines = designLines();
  const start = lines.indexOf(`#### ${heading}`);
  if (start < 0) throw new Error(`Design document has no "#### ${heading}"`);
  const table: string[] = [];
  for (let index = start + 1; index < lines.length; index++) {
    if (lines[index].startsWith('#')) break;
    if (lines[index].startsWith('|')) table.push(lines[index]);
  }
  if (table.length < 3) throw new Error(`"${heading}" has no table rows`);
  return table.slice(2).map((line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );
}

export interface DocField {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
  readonly type: string;
}

/** Rows of a `Field | Offset | Size | Type` table. */
export function designFields(heading: string): DocField[] {
  return designTable(heading).map(([name, offset, size, type]) => ({
    name,
    offset: Number(offset),
    size: Number(size),
    type,
  }));
}

/** Rows of a `Code | Name` table as name to code. */
export function designCodes(heading: string): Record<string, number> {
  return Object.fromEntries(
    designTable(heading).map(([code, name]) => [name, Number(code)]),
  );
}

/** Rows of a `Bit | Name` table as name to bit mask. */
export function designBits(heading: string): Record<string, number> {
  return Object.fromEntries(
    designTable(heading).map(([bit, name]) => [name, 1 << Number(bit)]),
  );
}
