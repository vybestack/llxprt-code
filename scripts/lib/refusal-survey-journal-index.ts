/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';

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

async function* readLines(
  file: string,
  malformed: Malformed,
): AsyncGenerator<unknown> {
  let lineNo = 0;
  const reader = createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    lineNo++;
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as unknown;
    } catch {
      malformed.count++;
      if (malformed.examples.length < 5)
        malformed.examples.push(`${file}:${lineNo}`);
    }
  }
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
    operation_id: payload['operation_id'],
  };
}

function journalRuntime(row: Obj): string {
  const payload = row['payload'];
  const rowRuntime = str(row['runtime_id']) ?? str(row['runtimeId']);
  if (rowRuntime !== null) return rowRuntime;
  if (!isObj(payload)) return '';
  return str(payload['runtime_id']) ?? str(payload['runtimeId']) ?? '';
}

export async function readJournalIndex(
  dir: string,
  malformed: Malformed,
): Promise<Journal[]> {
  const records: Journal[] = [];
  for (const file of walk(path.join(dir, 'chats')).filter((name) =>
    name.endsWith('.jsonl'),
  )) {
    let session = path.basename(file, '.jsonl');
    for await (const row of readLines(file, malformed)) {
      if (
        !isObj(row) ||
        typeof row['type'] !== 'string' ||
        !isObj(row['payload'])
      )
        continue;
      if (row['type'] === 'session_start') {
        session = str(row['payload']['sessionId']) ?? session;
        records.push({
          seq: num(row['seq']) ?? -1,
          ts: str(row['ts']) ?? '',
          type: row['type'],
          payload: {
            cwd: row['payload']['cwd'],
            workspace: row['payload']['workspace'],
            workspaceDirs: row['payload']['workspaceDirs'],
            project: row['payload']['project'],
          },
          session,
          runtime: journalRuntime(row),
        });
      } else if (
        [
          'content',
          'tool_response',
          'compressed',
          'refusal',
          'refusal_rewrite',
        ].includes(row['type'])
      ) {
        records.push({
          seq: num(row['seq']) ?? -1,
          ts: str(row['ts']) ?? '',
          type: row['type'],
          payload:
            row['type'] === 'content' || row['type'] === 'tool_response'
              ? compactContent(row['type'], row['payload'])
              : compactAudit(row['type'], row['payload']),
          session,
          runtime: journalRuntime(row),
        });
      }
    }
  }
  return records.sort(
    (a, b) =>
      a.session.localeCompare(b.session) ||
      a.seq - b.seq ||
      a.ts.localeCompare(b.ts),
  );
}
