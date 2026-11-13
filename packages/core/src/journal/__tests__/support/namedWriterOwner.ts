/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { NamedWriterOwnership } from '../../named-writer-ownership.js';
import type { JournalSessionOptions } from '../../../services/history/journalSession.js';

/** A test process's stores share the same writer-exclusion domain. */
export const testNamedWriters = new NamedWriterOwnership();

export function testJournalOptions(
  options: JournalSessionOptions = {},
): JournalSessionOptions {
  return { ...options, namedWriters: options.namedWriters ?? testNamedWriters };
}

export function withTestNamedWriters<T extends object>(
  options: T & { readonly journal?: JournalSessionOptions },
): T & { readonly journal: JournalSessionOptions } {
  return { ...options, journal: testJournalOptions(options.journal) };
}
