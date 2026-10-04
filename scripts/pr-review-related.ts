/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { readArtifacts } from './pr-review-artifacts.ts';

import { relatedItemSchema } from './pr-review-local.ts';
type RelatedItem = z.infer<typeof relatedItemSchema>;
const searchItemSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.string(),
  repository_url: z.string(),
  state: z.string(),
  pull_request: z.object({}).optional(),
});
function relatedSearchWords(title: string, issueTitles: string[]): string[] {
  const words = [
    ...new Set(
      `${issueTitles.join(' ')} ${title}`
        .toLowerCase()
        .match(/[a-z][a-z0-9]{3,30}/g) ?? [],
    ),
  ]
    .filter(
      (word) =>
        ![
          'fixes',
          'issue',
          'implements',
          'changes',
          'containers',
          'with',
          'from',
          'that',
        ].includes(word),
    )
    .slice(0, 4);
  return words;
}
export async function discoverRelated({
  repository,
  title,
  linkedIssues,
  pullRequestNumber,
  token,
  transport = fetch,
}: {
  repository: string;
  title: string;
  linkedIssues: unknown[];
  pullRequestNumber: number;
  token?: string;
  transport?: typeof fetch;
}): Promise<RelatedItem[]> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error('Invalid related repository');
  const linked = z
    .array(z.object({ number: z.number(), title: z.string().optional() }))
    .parse(linkedIssues);
  const words = relatedSearchWords(
    title,
    linked.map((issue) => issue.title ?? ''),
  );
  const url = new URL('https://api.github.com/search/issues');
  url.searchParams.set(
    'q',
    `repo:${repository} ${words.length ? `${words.join(' OR ')} in:title,body` : ''}`.trim(),
  );
  url.searchParams.set('per_page', '20');
  url.searchParams.set('sort', 'updated');
  const response = await transport(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok)
    throw new Error(`Related retrieval HTTP ${response.status}`);
  const parsed = z
    .object({
      incomplete_results: z.literal(false),
      items: z.array(searchItemSchema).max(20),
    })
    .safeParse(await response.json());
  if (!parsed.success) throw new Error('Invalid verified related corpus');
  const verified = parsed.data.items.map((item): RelatedItem => {
    const kind = item.pull_request ? 'pull-request' : 'issue';
    const expected = `https://github.com/${repository}/${kind === 'issue' ? 'issues' : 'pull'}/${item.number}`;
    if (
      item.repository_url !== `https://api.github.com/repos/${repository}` ||
      item.html_url !== expected
    )
      throw new Error('Invalid verified related corpus');
    return {
      number: item.number,
      title: item.title.slice(0, 160),
      body: (item.body ?? '').slice(0, 240),
      url: expected,
      kind,
      state: item.state,
    };
  });
  const result: RelatedItem[] = [];
  for (const item of verified) {
    const excluded =
      item.number === pullRequestNumber ||
      linked.some((issue) => issue.number === item.number) ||
      result.some((existing) => existing.number === item.number);
    if (!excluded) {
      if (Buffer.byteLength(JSON.stringify([...result, item])) > 6000) break;
      result.push(item);
    }
  }
  return result;
}
async function main(): Promise<void> {
  const reviewDir = process.env.REVIEW_DIR || 'review';
  await fs.mkdir(reviewDir, { recursive: true });
  try {
    const artifacts = z
      .object({
        prContext: z.object({ title: z.string(), number: z.number() }),
        issues: z.array(z.unknown()),
      })
      .parse(await readArtifacts(reviewDir));
    const items = await discoverRelated({
      repository: process.env.REPO ?? '',
      title: artifacts.prContext.title,
      pullRequestNumber: artifacts.prContext.number,
      linkedIssues: artifacts.issues,
      token: process.env.GH_TOKEN,
    });
    await fs.writeFile(
      path.join(reviewDir, 'related.json'),
      JSON.stringify({ state: 'complete', items }, null, 2),
    );
  } catch {
    console.error(
      'Related discovery unavailable (read-only retrieval or metadata validation).',
    );
    await fs.writeFile(
      path.join(reviewDir, 'related.json'),
      JSON.stringify({ state: 'unavailable', items: [] }),
    );
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await main();
