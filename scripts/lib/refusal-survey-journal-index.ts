/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { sha256KeyHash } from '../../packages/core/src/journal/idKeys.js';
import {
  openJournalReadOnly,
  type JournalReader,
} from '../../packages/core/src/journal/journalReader.js';
import {
  contentRowsOf,
  metaEntriesOf,
  stateEntriesOf,
  stateReaderOf,
} from '../../packages/core/src/journal/journalReaderState.js';
import { RefusalPayloadSchema } from '../../packages/core/src/recording/refusalPayload.js';
import { RefusalRewritePayloadSchema } from '../../packages/core/src/recording/refusalRewritePayload.js';
import { SESSION_FILE_EXTENSION } from '../../packages/core/src/recording/sessionFileExtension.js';
import { readSessionFacts } from '../../packages/core/src/recording/sessionMetaKeys.js';
import { isCompressionSummary } from '../../packages/core/src/services/history/compressionSummaryScratchpad.js';

/** State map keys of refusal audits: `refusal:<promptId>:<attemptIndex>:<action>`. */
const REFUSAL_KEY_PREFIX = 'refusal:';
/** Metadata map keys of rewrite audits: `refusal_rewrite:<operationId>`. */
const REWRITE_KEY_PREFIX = 'refusal_rewrite:';
const UTF8 = new TextDecoder();

export type Journal = {
  seq: number;
  ts: string;
  type: string;
  payload: Record<string, unknown>;
  session: string;
  runtime: string;
};

function hasStableIdentity(
  entry: Journal,
  identity: { readonly session: string; readonly runtime: string },
): boolean {
  return (
    identity.session !== '' &&
    identity.runtime !== '' &&
    entry.session === identity.session &&
    entry.runtime === identity.runtime
  );
}

export function hasRecoveryContent(
  journal: readonly Journal[],
  prompt: string,
  attemptIndex: number | null,
  identity?: { readonly session: string; readonly runtime: string },
): boolean | undefined {
  const refusal = journal.find(
    (entry) =>
      entry.type === 'refusal' &&
      str(entry.payload['prompt_id']) === prompt &&
      num(entry.payload['attempt_index']) === attemptIndex,
  );
  if (refusal === undefined) return false;
  if (identity === undefined || !hasStableIdentity(refusal, identity)) {
    return undefined;
  }
  const candidates = journal.filter((entry) => {
    if (entry.type !== 'content' || entry.seq <= refusal.seq) return false;
    if (!hasStableIdentity(entry, identity)) return false;
    return str(entry.payload['prompt_id']) === prompt;
  });
  if (candidates.length === 0) return undefined;
  return candidates.some((entry) => {
    if (Date.parse(entry.ts) > Date.parse(refusal.ts) + 5 * 60_000)
      return false;
    const content = entry.payload['content'];
    return isObj(content) && content['speaker'] === 'ai';
  });
}

type Malformed = { count: number; examples: string[] };
type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function compactToolResponse(value: Obj): Obj {
  const result = isObj(value['result']) ? value['result'] : {};
  return {
    type: 'tool_response',
    toolName: str(value['toolName']) ?? 'unknown',
    result: toolOutput(result).slice(0, 300),
  };
}

function toolOutput(result: Obj): string {
  const output = str(result['output']);
  if (output !== null) return output;
  const error = result['error'];
  if (typeof error === 'string') return error;
  return isObj(error) ? (str(error['message']) ?? '') : '';
}

function walk(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) found.push(file);
    }
  };
  visit(root);
  return found.sort();
}

function compactContent(type: string, payload: Obj): Obj {
  if (type === 'tool_response') return compactToolResponse(payload);
  const content = isObj(payload['content']) ? payload['content'] : {};
  const metadata = isObj(content['metadata']) ? content['metadata'] : {};
  const blocks = Array.isArray(content['blocks']) ? content['blocks'] : [];
  return {
    prompt_id:
      str(payload['prompt_id']) ??
      str(metadata['promptId']) ??
      str(metadata['prompt_id']),
    content: {
      speaker: content['speaker'],
      blocks: blocks.flatMap((block): Obj[] => {
        if (!isObj(block)) return [];
        if (block['type'] === 'text' && typeof block['text'] === 'string')
          return [{ type: 'text', text: block['text'].slice(0, 300) }];
        if (
          block['type'] === 'thinking' &&
          typeof block['thought'] === 'string'
        )
          return [
            { type: 'thinking', thought: block['thought'].slice(0, 300) },
          ];
        if (block['type'] === 'tool_call')
          return [{ type: 'tool_call', name: block['name'] }];
        if (block['type'] === 'tool_response')
          return [compactToolResponse(block)];
        return [];
      }),
    },
  };
}

function compactAudit(type: string, payload: Obj): Obj {
  if (type === 'compressed') {
    return {
      summaryAuthor: payload['summaryAuthor'],
      summary_author_model: payload['summary_author_model'],
      summary_author_provider: payload['summary_author_provider'],
    };
  }
  return {
    prompt_id: payload['prompt_id'] ?? payload['promptId'],
    attempt_index: payload['attempt_index'] ?? payload['attemptIndex'],

    refusal_category: payload['refusal_category'],
    partial_output: payload['partial_output'],
    dump_base_id: payload['dump_base_id'],
    operation_id: payload['operation_id'] ?? payload['operationId'],
  };
}

/**
 * A refusal audit (state map) or rewrite audit (metadata map): its survey
 * record type, its payload and when it was recorded.
 */
type Audit = {
  readonly type: 'refusal' | 'refusal_rewrite';
  readonly payload: Obj;
  readonly time: number;
};

type AuditSchema =
  | typeof RefusalPayloadSchema
  | typeof RefusalRewritePayloadSchema;

async function collectAudits(
  entries: AsyncIterable<{ readonly key: string; readonly value: Uint8Array }>,
  type: Audit['type'],
  schema: AuditSchema,
  file: string,
  malformed: Malformed,
  audits: Audit[],
): Promise<void> {
  for await (const { key, value } of entries) {
    const parsed = schema.safeParse(parseJson(UTF8.decode(value)));
    if (!parsed.success) {
      noteMalformed(malformed, `${file}:${key}`);
      continue;
    }
    audits.push({
      type,
      payload: { ...parsed.data },
      time: Date.parse(parsed.data.time),
    });
  }
}

async function auditsOf(
  reader: JournalReader,
  file: string,
  malformed: Malformed,
): Promise<Audit[]> {
  const audits: Audit[] = [];
  await collectAudits(
    stateEntriesOf(reader, REFUSAL_KEY_PREFIX),
    'refusal',
    RefusalPayloadSchema,
    file,
    malformed,
    audits,
  );
  await collectAudits(
    metaEntriesOf(reader, REWRITE_KEY_PREFIX),
    'refusal_rewrite',
    RefusalRewritePayloadSchema,
    file,
    malformed,
    audits,
  );
  return audits.sort((left, right) => left.time - right.time);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function noteMalformed(malformed: Malformed, where: string): void {
  malformed.count++;
  if (malformed.examples.length < 5) malformed.examples.push(where);
}

const isoOf = (ms: number): string =>
  Number.isFinite(ms) ? new Date(ms).toISOString() : '';

/**
 * The survey records of one journal session in recorded order. Rows come in
 * label order. A refusal audit (state map) or rewrite audit (metadata map)
 * is not a row, so it is placed before the first row whose chronology
 * `recordedAt` is later than the audit's own `time`; a row recorded in the same millisecond counts as
 * before the refusal, so recovery needs content that is strictly later. A
 * row with no chronology keeps its label position. Each record's `seq` is its
 * position in that merged order.
 */
async function* sessionRecords(
  reader: JournalReader,
  file: string,
  malformed: Malformed,
): AsyncGenerator<Journal> {
  const facts = await readSessionFacts(stateReaderOf(reader, sha256KeyHash));
  if (facts === undefined) return;
  const session = facts.sessionId;
  let seq = 0;
  const record = (type: string, ts: string, payload: Obj): Journal => ({
    seq: seq++,
    ts,
    type,
    payload,
    session,
    runtime: '',
  });
  yield record('session_start', facts.start.startTime, {
    cwd: facts.start.cwd,
    workspaceDirs: facts.directories,
  });
  const audits = await auditsOf(reader, file, malformed);
  const refusal = (audit: Audit): Journal =>
    record(
      audit.type,
      isoOf(audit.time),
      compactAudit(audit.type, audit.payload),
    );
  for await (const content of contentRowsOf(reader)) {
    const recordedAt = content.metadata?.chronology?.recordedAt;
    while (
      recordedAt !== undefined &&
      audits.length > 0 &&
      audits[0].time < recordedAt
    ) {
      const audit = audits.shift();
      if (audit !== undefined) yield refusal(audit);
    }
    const ts = recordedAt === undefined ? '' : isoOf(recordedAt);
    yield record('content', ts, compactContent('content', { content }));
    if (isCompressionSummary(content)) {
      const provenance = content.metadata?.compressionProvenance;
      yield record(
        'compressed',
        ts,
        compactAudit('compressed', {
          summary_author_model: provenance?.summaryAuthorModel ?? null,
          summary_author_provider: provenance?.summaryAuthorProvider ?? null,
        }),
      );
    }
  }
  for (const audit of audits) yield refusal(audit);
}

/**
 * The survey records of every journal session under `dir/chats`. Each file is
 * read through a read-only view: rows one at a time from the row tree and
 * refusal audits from the state map entries under the `refusal:` prefix and
 * rewrite audits from the metadata map entries under `refusal_rewrite:`, so
 * no file is loaded whole. A file that cannot be read is external input and
 * is counted as malformed.
 */
export async function readJournalIndex(
  dir: string,
  malformed: Malformed,
): Promise<Journal[]> {
  const records: Journal[] = [];
  for (const file of walk(path.join(dir, 'chats')).filter((name) =>
    name.endsWith(SESSION_FILE_EXTENSION),
  )) {
    let reader: JournalReader;
    try {
      reader = await openJournalReadOnly(file);
    } catch {
      noteMalformed(malformed, file);
      continue;
    }
    try {
      for await (const record of sessionRecords(reader, file, malformed))
        records.push(record);
    } catch {
      noteMalformed(malformed, file);
    } finally {
      await reader.close();
    }
  }
  return records.sort(
    (a, b) =>
      a.session.localeCompare(b.session) ||
      a.seq - b.seq ||
      a.ts.localeCompare(b.ts),
  );
}
