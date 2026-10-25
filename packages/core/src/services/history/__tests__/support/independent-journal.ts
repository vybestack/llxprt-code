/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { copyFile, rm } from 'node:fs/promises';
import { JournalSession } from '../../journalSession.js';

const copies: string[] = [];
afterEach(async () => {
  for (const file of copies.splice(0)) await rm(file, { force: true });
});

export async function openIndependentJournal(
  file: string,
): Promise<JournalSession> {
  const copy = `${file}.inspection-${randomUUID()}`;
  await copyFile(file, copy);
  copies.push(copy);
  return JournalSession.open(copy);
}
