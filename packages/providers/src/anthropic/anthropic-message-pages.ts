/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { NativeFactIndexWriter } from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import type { ScalarFacts } from './anthropic-repair-index.js';

const MESSAGES_PER_PAGE = 32;
const SCALARS_PER_MESSAGE = 5;
interface MessagePage {
  readonly ordinal: number;
  readonly values: number[];
  dirty: boolean;
}
// One numeric page per reader/writer, independent of the history length.
const pages = new WeakMap<ScalarFacts, MessagePage>();

async function save(facts: ScalarFacts, page: MessagePage): Promise<void> {
  if (!page.dirty) return;
  if (!(facts instanceof NativeFactIndexWriter))
    throw new JournalFormatError('Cannot write an Anthropic message reader');
  const bytes = new Uint8Array(page.values.length * 4);
  const view = new DataView(bytes.buffer);
  for (const [at, value] of page.values.entries())
    view.setUint32(at * 4, value, true);
  await facts.setBytes(['message-page', page.ordinal], bytes);
  page.dirty = false;
}

async function pageAt(
  facts: ScalarFacts,
  ordinal: number,
): Promise<MessagePage> {
  const current = pages.get(facts);
  if (current?.ordinal === ordinal) return current;
  if (current !== undefined) await save(facts, current);
  const bytes = await facts.getBytes(['message-page', ordinal]);
  if (
    bytes !== undefined &&
    (bytes.length % (SCALARS_PER_MESSAGE * 4) !== 0 ||
      bytes.length > MESSAGES_PER_PAGE * SCALARS_PER_MESSAGE * 4)
  )
    throw new JournalFormatError('Invalid Anthropic message page');
  const values: number[] = [];
  if (bytes !== undefined) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let at = 0; at < bytes.length; at += 4)
      values.push(view.getUint32(at, true));
  }
  const page = { ordinal, values, dirty: false };
  pages.set(facts, page);
  return page;
}

export async function readMessageScalars(
  facts: ScalarFacts,
  ordinal: number,
): Promise<readonly number[] | undefined> {
  const page = await pageAt(
    facts,
    Math.floor((ordinal - 1) / MESSAGES_PER_PAGE),
  );
  const at = ((ordinal - 1) % MESSAGES_PER_PAGE) * SCALARS_PER_MESSAGE;
  return at >= page.values.length ? undefined : page.values.slice(at, at + 5);
}

export async function writeMessageScalars(
  writer: NativeFactIndexWriter,
  ordinal: number,
  values: readonly number[],
): Promise<void> {
  const page = await pageAt(
    writer,
    Math.floor((ordinal - 1) / MESSAGES_PER_PAGE),
  );
  const at = ((ordinal - 1) % MESSAGES_PER_PAGE) * SCALARS_PER_MESSAGE;
  if (at > page.values.length || values.length !== SCALARS_PER_MESSAGE)
    throw new JournalFormatError('Anthropic message pages must be contiguous');
  for (const [index, value] of values.entries()) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff)
      throw new JournalFormatError(
        'Anthropic message scalar is outside uint32',
      );
    page.values[at + index] = value;
  }
  page.dirty = true;
}

export async function flushMessagePages(
  writer: NativeFactIndexWriter,
): Promise<void> {
  const page = pages.get(writer);
  if (page !== undefined) await save(writer, page);
}
