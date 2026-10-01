/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { extractJsonObject } from './pr-review-walkthrough-parse.ts';
import { relatedSelectionSchema } from './pr-review-evidence.ts';
import { DEFAULT_PR_TEMPLATE_SECTIONS } from './pr-review-prompts.ts';
import {
  DEFAULT_MAX_TOKENS as OUTPUT_TOKENS,
  DEFAULT_CONTEXT_LIMIT as CONTEXT_TOKENS,
} from './pr-review-llm-helpers.ts';

export const LOCAL_REVIEW_MODEL = 'qwen3.5:4b';
export const LOCAL_REVIEW_ENDPOINT = 'http://127.0.0.1:12644';
export const LOCAL_REVIEW_INPUT_BYTES = 20000;

export function batchReviewInputs<T>(
  items: readonly T[],
  render: (batch: T[]) => string,
  maxItems = Number.POSITIVE_INFINITY,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    const next = [...current, item];
    if (
      next.length > maxItems ||
      Buffer.byteLength(render(next), 'utf8') > LOCAL_REVIEW_INPUT_BYTES
    ) {
      if (current.length) batches.push(current);
      current = [item];
      if (Buffer.byteLength(render(current), 'utf8') > LOCAL_REVIEW_INPUT_BYTES)
        throw new Error(
          'Local review single evidence item exceeds input budget',
        );
    } else current = next;
  }
  if (current.length) batches.push(current);
  return batches;
}

const responseSchema = z.object({
  message: z.object({ content: z.string().trim().min(1) }),
  done: z.literal(true),
  done_reason: z.literal('stop'),
  prompt_eval_count: z
    .number()
    .int()
    .nonnegative()
    .max(CONTEXT_TOKENS - OUTPUT_TOKENS),
  eval_count: z
    .number()
    .int()
    .nonnegative()
    .max(OUTPUT_TOKENS - 1),
  error: z.never().optional(),
});

function requireLocalEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  const transport = url.protocol === 'http:' && url.hostname === '127.0.0.1';
  const credentials = url.username || url.password;
  const path = url.pathname !== '/' || url.search || url.hash;
  if (!transport || credentials || path)
    throw new Error(
      'Local review requires a credential-free loopback endpoint',
    );
  return url;
}

export function createLocalReviewRunner({
  endpoint = LOCAL_REVIEW_ENDPOINT,
  model = LOCAL_REVIEW_MODEL,
  think = false,
  factualThink = true,
  timeoutMs = 600000,
  budgetMs = 2700000,
  mapBudgetMs = budgetMs / 3,
  evidenceDir,
}: {
  endpoint?: string;
  model?: string;
  think?: boolean;
  factualThink?: boolean;
  timeoutMs?: number;
  budgetMs?: number;
  mapBudgetMs?: number;
  evidenceDir?: string;
} = {}): (
  prompt: string,
  responseFormat?: object,
  options?: { phase?: string },
) => Promise<string> {
  const url = requireLocalEndpoint(endpoint);
  const deadline = Date.now() + budgetMs;
  const mapDeadline = Date.now() + mapBudgetMs;
  let pending: Promise<unknown> = Promise.resolve();
  let sequence = 0;
  return (
    prompt: string,
    responseFormat?: object,
    options: { phase?: string } = {},
  ): Promise<string> => {
    const run = async (): Promise<string> => {
      const started = Date.now();
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error('Local review shared deadline exceeded');
      if (Buffer.byteLength(prompt, 'utf8') > LOCAL_REVIEW_INPUT_BYTES)
        throw new Error('Local review input budget exceeded');
      const mapRemaining = mapDeadline - Date.now();
      if (options.phase === 'map' && mapRemaining <= 0)
        throw new Error('Local review mapping allowance exceeded');
      const request = localInferenceRequest(
        model,
        prompt,
        ['pre-merge'].includes(options.phase ?? '') ? factualThink : think,
        responseFormat,
        options.phase,
      );
      sequence += 1;
      return completeInference(
        new URL('/api/chat', url),
        request,
        Math.min(
          timeoutMs,
          remaining,
          phaseTimeout(options.phase, timeoutMs, mapRemaining),
        ),
        evidenceDir,
        sequence,
        started,
        {
          model,
          phase: options.phase,
          endpoint: url.origin,
          inputBytes: Buffer.byteLength(prompt),
          prompt,
        },
      );
    };
    const result = pending.then(run);
    pending = result.catch(() => undefined);
    return result;
  };
}

function localInferenceRequest(
  model: string,
  prompt: string,
  think: boolean,
  responseFormat?: object,
  phase?: string,
): object {
  return {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    think,
    format: responseFormat ?? 'json',
    keep_alive: '60m',
    options: {
      num_ctx: CONTEXT_TOKENS,
      num_predict: outputBudget(phase),
      temperature: 0,
    },
  };
}

function outputBudget(phase?: string): number {
  if (phase === 'pre-merge') return OUTPUT_TOKENS;
  if (phase === 'synthesis') return 2048;
  return 1024;
}
function phaseTimeout(
  phase: string | undefined,
  timeoutMs: number,
  mapRemaining: number,
): number {
  if (phase === 'map') return Math.min(mapRemaining, 120000);
  if (phase === 'pre-merge') return timeoutMs;
  return 180000;
}
async function completeInference(
  url: URL,
  request: object,
  timeoutMs: number,
  evidenceDir: string | undefined,
  sequence: number,
  started: number,
  metadata: object,
): Promise<string> {
  const response = await fetchLocalInference(url, request, timeoutMs);
  const raw: unknown = response.ok
    ? await response.json()
    : await response.text();
  await saveInference(evidenceDir, sequence, {
    ...metadata,
    elapsedMs: Date.now() - started,
    request,
    httpStatus: response.status,
    result: raw,
  });
  if (!response.ok) throw new Error('Local inference HTTP ' + response.status);
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error('Local inference incomplete or invalid response');
  return parsed.data.message.content;
}

export function splitReviewDiff(
  content: string,
  maxBytes = 12000,
): Array<{ content: string; available: boolean }> {
  const parts = content.split(/(?=^@@ )/m);
  const header = parts[0];
  const hunks = parts.slice(1).flatMap((hunk) => {
    if (Buffer.byteLength(header + hunk) <= maxBytes) return [hunk];
    const lines = hunk.split('\n');
    const anchor = lines[0];
    const segments: string[] = [];
    let current = '';
    let start = 1;
    for (let index = 1; index < lines.length; index++) {
      const line = lines[index] + (index < lines.length - 1 ? '\n' : '');
      if (
        current &&
        Buffer.byteLength(header + anchor + current + line) > maxBytes - 160
      ) {
        segments.push(`${anchor}
Partial original hunk, diff-body lines ${start}-${index - 1}:
${current}`);
        current = '';
        start = index;
      }
      current += line;
    }
    if (current)
      segments.push(`${anchor}
Partial original hunk, diff-body lines ${start}-${lines.length - 1}:
${current}`);
    return segments;
  });
  const packets =
    parts.length === 1
      ? [content]
      : hunks.reduce<string[]>((packets, hunk) => {
          const last = packets.at(-1);
          return last && Buffer.byteLength(last + hunk) <= maxBytes
            ? [...packets.slice(0, -1), last + hunk]
            : [...packets, header + hunk];
        }, []);
  return packets.map((packet) => ({
    content: packet,
    available: Buffer.byteLength(packet) <= maxBytes,
  }));
}

const text = z.string().trim().min(1);
const synthesisSchema = z.object({ walkthrough: text, release_notes: text });
const checkSchema = z.object({ note: text.max(1000), ok: z.boolean() });
const preMergeSchema = z.object({
  title: checkSchema,
  description: checkSchema,
  linked_issues: checkSchema,
  out_of_scope: z.object({ note: text }),
});

export function parseSynthesis(raw: string): z.infer<typeof synthesisSchema> {
  return synthesisSchema.parse(extractJsonObject(raw));
}
export function parsePreMergeChecks(
  raw: string,
): z.infer<typeof preMergeSchema> {
  return preMergeSchema.parse(extractJsonObject(raw));
}
export function reviewResponseFormat(phase: string): object {
  const schemas: Record<string, z.ZodTypeAny> = {
    map: z.object({
      summary: text.max(1000),
      signature: z.string(),
      triage: z.enum([
        'feature',
        'test',
        'docs',
        'refactor',
        'fix',
        'chore',
        'ci',
      ]),
    }),
    group: z.object({
      themes: z
        .array(
          z.object({
            layer: text,
            files: z.array(text).min(1),
            summary: text.max(500),
          }),
        )
        .min(1),
    }),
    synthesis: synthesisSchema,
    diagram: z.object({ diagram: z.string() }),
    related: relatedSelectionSchema,
    'pre-merge': preMergeSchema,
    'acceptance-evidence': z.object({ evidence: text.max(1000) }),
  };
  const schema = schemas[phase];
  if (!schema) throw new Error(`Unknown review phase: ${phase}`);
  return zodToJsonSchema(schema, { target: 'jsonSchema7' });
}

export const relatedItemSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  kind: z.enum(['issue', 'pull-request']),
  state: z.string(),
});

export function validateRelated(related: string, issues: unknown[]): string {
  const corpus = issues.flatMap((issue) => {
    const parsed = z
      .object({
        number: z.number().int().positive(),
        url: z.string().optional(),
        html_url: z.string().optional(),
      })
      .safeParse(issue);
    return parsed.success ? [parsed.data] : [];
  });
  const references = [...related.matchAll(/#(\d+)/g)].map((match) => match[1]);
  if (
    related.trim() &&
    (references.length === 0 ||
      /[\w.-]#\d/.test(related) ||
      references.some(
        (number) => !corpus.some((item) => String(item.number) === number),
      ))
  )
    throw new Error('Related output contains unverified references');
  marked.walkTokens(marked.lexer(related), (token) => {
    if (token.type === 'html' || token.type === 'image')
      throw new Error('Related output contains unverified references');
    if (token.type === 'link') {
      const number = /^#(\d+)$/.exec(token.text)?.[1];
      if (
        !corpus.some(
          (item) =>
            String(item.number) === number &&
            (item.url ?? item.html_url) === token.href,
        )
      )
        throw new Error('Related output contains unverified references');
    }
  });
  return related;
}

export function checkDescription(body: string): { ok: boolean; note: string } {
  const headings = body
    .split('\n')
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .trim()
        .toLowerCase(),
    );
  const missing = DEFAULT_PR_TEMPLATE_SECTIONS.filter(
    (section) => !headings.includes(section.toLowerCase()),
  );
  return {
    ok: missing.length === 0,
    note: missing.length
      ? `Missing template sections: ${missing.join(', ')}.`
      : 'All expected template sections are present. Testing claims still require independent verification.',
  };
}

async function saveInference(
  evidenceDir: string | undefined,
  sequence: number,
  evidence: object,
): Promise<void> {
  if (!evidenceDir) return;
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDir, 'inference-' + sequence + '.json'),
    JSON.stringify(evidence, null, 2),
  );
}

async function fetchLocalInference(
  url: URL,
  request: object,
  timeoutMs: number,
): Promise<Response> {
  const options: RequestInit & { timeout: false } = {
    method: 'POST',
    redirect: 'manual',
    timeout: false,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  };
  return fetch(url, options);
}
