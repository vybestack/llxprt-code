/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { extractJsonObject } from './pr-review-walkthrough-parse.ts';

export const observationSchema = z.object({
  quote: z.string().trim().min(1).max(1000),
  claim: z.string().trim().min(1).max(400),
});
export const sourceContextSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  path: z.string().min(1),
  content: z.string(),
});
export type SourceContext = z.infer<typeof sourceContextSchema>;
export function bindSourceEvidence(
  filePath: string,
  diff: string,
  packet: number,
  observations: unknown,
  context: SourceContext[] = [],
): {
  path: string;
  packet: number;
  kind: 'documentation' | 'test' | 'implementation' | 'dependency';
  execution: 'not-observed';
  diffSha256: string;
  observations: Array<z.infer<typeof observationSchema>>;
  context: SourceContext[];
} {
  const parsed = z.array(observationSchema).max(8).parse(observations);
  if (parsed.some((item) => !diff.includes(item.quote)))
    throw new Error('Invalid map response: source quote is absent from packet');
  let kind: 'documentation' | 'test' | 'implementation' | 'dependency' =
    'implementation';
  if (/\.(md|mdx|rst|txt|adoc)$/i.test(filePath)) kind = 'documentation';
  else if (/(?:\.(test|spec)\.|(?:^|\/)(?:tests?|__tests__)\/)/.test(filePath))
    kind = 'test';
  else if (
    /(?:^|\/)(?:bun\.lock|package-lock\.json|yarn\.lock)$/.test(filePath)
  )
    kind = 'dependency';
  return {
    path: filePath,
    packet,
    kind,
    execution: 'not-observed',
    diffSha256: createHash('sha256').update(diff).digest('hex'),
    observations: parsed,
    context: z.array(sourceContextSchema).parse(context),
  };
}

export const relatedSelectionSchema = z
  .object({
    selections: z
      .array(
        z
          .object({
            number: z.number().int().positive(),
            reason: z.string().trim().min(1).max(240),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
function plainMarkdown(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/([\\`*_[\]{}()#!|])/g, '\\$1')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/:/g, '&#58;')
    .replace(/@/g, '&#64;');
}
export function renderRelatedSelections(raw: string, items: unknown[]): string {
  const selections = relatedSelectionSchema.parse(
    extractJsonObject(raw),
  ).selections;
  const corpus = z
    .array(
      z.object({
        number: z.number().int().positive(),
        title: z.string().default(''),
        kind: z.enum(['issue', 'pull-request']).optional(),
        url: z.string().optional(),
        html_url: z.string().optional(),
      }),
    )
    .parse(items);
  if (new Set(selections.map((item) => item.number)).size !== selections.length)
    throw new Error('Invalid related selection: duplicate number');
  return selections
    .map((selection) => {
      const item = corpus.find(
        (candidate) => candidate.number === selection.number,
      );
      if (!item)
        throw new Error('Invalid related selection: unverified number');
      const url = item.url ?? item.html_url;
      if (
        url &&
        item.kind &&
        url !==
          `https://github.com/vybestack/llxprt-code/${item.kind === 'issue' ? 'issues' : 'pull'}/${item.number}`
      )
        throw new Error('Invalid related selection: destination type mismatch');
      if (
        url &&
        ![
          `https://github.com/vybestack/llxprt-code/issues/${item.number}`,
          `https://github.com/vybestack/llxprt-code/pull/${item.number}`,
        ].includes(url)
      )
        throw new Error('Invalid related selection: unverified destination');
      const reference = url ? `[#${item.number}](${url})` : `#${item.number}`;
      return `- ${reference}: ${plainMarkdown(item.title)}${item.title ? '. ' : ''}${plainMarkdown(selection.reason)}`;
    })
    .join('\n');
}

export async function readSourceContext(
  reviewDir: string,
): Promise<Record<string, SourceContext[]>> {
  const file = path.join(reviewDir, 'source-context.json');
  let content: string;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return {};
    throw error;
  }
  return z.record(z.array(sourceContextSchema)).parse(JSON.parse(content));
}
