/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { ContextSpan } from '../../journal/contextSpanFacts.js';

export function journalContextSpan(bytes: Uint8Array): ContextSpan | undefined {
  const piece: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof piece !== 'object' || piece === null)
    throw new JournalFormatError('Invalid history metadata');
  const metadata: unknown = Reflect.get(piece, 'metadata');
  if (typeof metadata !== 'object' || metadata === null) return undefined;
  const replaced: unknown = Reflect.get(metadata, 'chronologyReplaced');
  if (replaced === undefined) return undefined;
  if (typeof replaced !== 'object' || replaced === null)
    throw new JournalFormatError('Invalid summary span');
  const start: unknown = Reflect.get(replaced, 'fromSeq');
  const end: unknown = Reflect.get(replaced, 'toSeq');
  if (typeof start !== 'number' || typeof end !== 'number')
    throw new JournalFormatError('Invalid summary span coordinates');
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start
  )
    throw new JournalFormatError('Invalid summary span coordinates');
  return { start, end };
}
