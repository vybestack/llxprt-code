/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { relatedItemSchema } from './pr-review-local.ts';

const recordSchema = z.record(z.unknown());
export interface ArtifactDiagnostic {
  category:
    | 'missing-artifact'
    | 'artifact-read'
    | 'artifact-json'
    | 'artifact-schema';
  operation: 'read' | 'parse' | 'validate';
  path: string;
}
export class ArtifactFailure extends Error {
  constructor(readonly diagnostic: ArtifactDiagnostic) {
    super(
      `Required artifact unavailable: ${diagnostic.operation} ${diagnostic.path}`,
    );
  }
}
function artifactPath(file: string): string {
  const basename = path
    .basename(file)
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .slice(0, 120);
  const parent = path.basename(path.dirname(file));
  return ['issues', 'diffs'].includes(parent)
    ? `${parent}/${basename}`
    : basename;
}
async function readRequired(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    const missing =
      error instanceof Error && 'code' in error && error.code === 'ENOENT';
    throw new ArtifactFailure({
      category: missing ? 'missing-artifact' : 'artifact-read',
      operation: 'read',
      path: artifactPath(file),
    });
  }
}
async function readRequiredJson(
  file: string,
  schema: z.ZodType<Record<string, unknown>> = recordSchema,
): Promise<Record<string, unknown>> {
  const content = await readRequired(file);
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new ArtifactFailure({
      category: 'artifact-json',
      operation: 'parse',
      path: artifactPath(file),
    });
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ArtifactFailure({
      category: 'artifact-schema',
      operation: 'validate',
      path: artifactPath(file),
    });
  return result.data;
}

async function readWithConcurrency<T>(
  items: T[],
  concurrencyLimit: number,
  asyncFn: (item: T) => Promise<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      results[index] = await asyncFn(item);
    }
  };
  const workerCount = Math.min(concurrencyLimit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function readArtifacts(
  reviewDir: string,
  { requireRelated = false }: { requireRelated?: boolean } = {},
): Promise<Record<string, unknown>> {
  const prPath = path.join(reviewDir, 'pr.json');
  const pr = await readRequiredJson(
    prPath,
    z
      .object({
        number: z.number(),
        title: z.string().min(1),
        body: z.string().optional(),
      })
      .passthrough(),
  );
  const issues = await readIssueFiles(reviewDir);
  if (issues.length === 0) {
    throw new ArtifactFailure({
      category: 'missing-artifact',
      operation: 'read',
      path: 'issues',
    });
  }
  const diffs = await readDiffFiles(reviewDir);
  const numstat = await readNumstat(reviewDir);
  const relatedPath = path.join(reviewDir, 'related.json');
  let relatedItems: unknown[] = [];
  let relatedUnavailable = false;
  const exists = await fs.access(relatedPath).then(
    () => true,
    () => false,
  );
  if (exists || requireRelated) {
    const related = await readRequiredJson(
      relatedPath,
      z.object({
        state: z.enum(['complete', 'unavailable']),
        items: z.array(relatedItemSchema).max(20),
      }),
    );
    relatedItems = z.array(relatedItemSchema).parse(related.items);
    relatedUnavailable = related.state !== 'complete';
  }
  return {
    ...buildArtifactContext(pr, issues, diffs, numstat),
    relatedItems,
    relatedUnavailable,
  };
}

async function readIssueFiles(
  reviewDir: string,
): Promise<Array<Record<string, unknown>>> {
  const issuesDir = path.join(reviewDir, 'issues');
  const files = await fs.readdir(issuesDir).catch(() => []);
  const issueFiles = files.filter((file) => file.endsWith('.json'));
  const results = await readWithConcurrency(
    issueFiles,
    8,
    async (file: string) => ({
      filePath: file,
      issue: await readRequiredJson(
        path.join(issuesDir, file),
        z
          .object({
            number: z.number().int().positive(),
            title: z.string().optional(),
            body: z.string().optional(),
          })
          .passthrough(),
      ),
    }),
  );
  const issues = collectArtifactReads(results, 'issue');
  if (issueFiles.length > 0 && issues.length === 0) {
    throw new Error(
      `All ${issueFiles.length} issue file(s) failed to parse in ${issuesDir}`,
    );
  }
  return issues.sort(
    (a: Record<string, unknown>, b: Record<string, unknown>) =>
      Number(a.number) - Number(b.number),
  );
}

async function readDiffFiles(
  reviewDir: string,
): Promise<Array<Record<string, unknown>>> {
  const diffsDir = path.join(reviewDir, 'diffs');
  const manifestPath = path.join(reviewDir, 'diff-manifest.txt');
  const manifest = await parseDiffManifest(manifestPath);
  const files = await fs.readdir(diffsDir).catch(() => []);
  const diffFiles = files.filter((file) => file.endsWith('.diff'));
  const results = await readWithConcurrency(
    diffFiles,
    8,
    async (file: string) => ({
      filePath: file,
      diff: {
        filePath: resolveOriginalPath(file, manifest),
        safeName: file,
        content: await readRequired(path.join(diffsDir, file)),
      },
    }),
  );
  const diffs = collectArtifactReads(results, 'diff');
  if (diffFiles.length > 0 && diffs.length === 0) {
    throw new Error(
      `All ${diffFiles.length} diff file(s) failed to read in ${diffsDir}`,
    );
  }
  return diffs;
}

function collectArtifactReads(
  results: Array<Record<string, unknown>>,
  valueKey: string,
): Array<Record<string, unknown>> {
  const values: Array<Record<string, unknown>> = [];
  for (const result of results) {
    if ('error' in result) {
      throw new Error(`Required artifact unavailable: ${result.filePath}`);
    } else {
      const value = result[valueKey];
      if (value !== undefined) {
        values.push(recordSchema.parse(value));
      }
    }
  }
  return values;
}

export async function parseDiffManifest(
  manifestPath: string,
): Promise<Map<string, string> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch {
    return null;
  }
  const map = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    const tabIdx = line.indexOf('\t');
    if (trimmed === '' || tabIdx === -1) {
      continue;
    }
    const safeName = line.slice(0, tabIdx).trim();
    const originalPath = line.slice(tabIdx + 1).trim();
    if (safeName && originalPath) {
      map.set(safeName, originalPath);
    }
  }
  return map;
}

export function resolveOriginalPath(
  safeDiffName: string,
  manifest: Map<string, string> | null,
): string {
  if (manifest) {
    const originalPath = manifest.get(safeDiffName);
    if (originalPath !== undefined) {
      return originalPath;
    }
  }
  return safeDiffName.replace(/__/g, '/').replace(/\.diff$/, '');
}

interface NumstatEntry {
  additions: number;
  deletions: number;
  filename: string;
}

async function readNumstat(reviewDir: string): Promise<NumstatEntry[]> {
  const numstatPath = path.join(reviewDir, 'numstat.txt');
  const raw = await fs.readFile(numstatPath, 'utf8').catch(() => '');
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [additions, deletions, filename] = line.split('\t');
      return {
        additions: Number(additions) || 0,
        deletions: Number(deletions) || 0,
        filename: filename ?? '',
      };
    });
}

export function buildArtifactContext(
  pr: Record<string, unknown>,
  issues: Array<Record<string, unknown>>,
  diffs: Array<Record<string, unknown>>,
  numstat: NumstatEntry[],
): Record<string, unknown> {
  const totalAdditions = numstat.reduce(
    (sum: number, n: NumstatEntry) => sum + n.additions,
    0,
  );
  const totalDeletions = numstat.reduce(
    (sum: number, n: NumstatEntry) => sum + n.deletions,
    0,
  );
  const changedFiles = Number(pr.changedFiles ?? numstat.length);
  const changedFilePaths = deriveChangedFilePaths(numstat, diffs);
  const prAuthor = recordSchema.safeParse(pr.author);
  const authorLogin =
    prAuthor.success && typeof prAuthor.data.login === 'string'
      ? prAuthor.data.login
      : undefined;
  const rawCommits = pr.commits;
  let commitCount: number | undefined;
  if (Array.isArray(rawCommits)) {
    commitCount = rawCommits.length;
  } else if (typeof rawCommits === 'number') {
    commitCount = rawCommits;
  }
  const closingReferences = pr.closingIssuesReferences;
  return {
    prContext: {
      number: pr.number,
      title: pr.title,
      author: authorLogin,
      body: pr.body,
      baseRefName: pr.baseRefName,
      headRefName: pr.headRefName,
      additions: Number(pr.additions ?? totalAdditions),
      deletions: Number(pr.deletions ?? totalDeletions),
      changedFiles,
      commits: commitCount,
    },
    issues,
    acceptanceMode:
      Array.isArray(closingReferences) && closingReferences.length === 0
        ? 'alignment'
        : 'fulfillment',
    acceptanceIssues:
      Array.isArray(closingReferences) && closingReferences.length > 0
        ? issues.filter((issue) =>
            closingReferences.some((reference: unknown) => {
              const parsed = recordSchema.safeParse(reference);
              return parsed.success && parsed.data.number === issue.number;
            }),
          )
        : issues,
    diffs,
    numstat,
    changedFilePaths,
    magnitudeInput: {
      additions: totalAdditions,
      deletions: totalDeletions,
      changedFiles,
      packageCount: countPackages(changedFilePaths),
      criteriaCount: countAcceptanceCriteria(issues),
    },
  };
}

function deriveChangedFilePaths(
  numstat: NumstatEntry[],
  diffs: Array<Record<string, unknown>>,
): string[] {
  const fromNumstat = numstat
    .map((n: NumstatEntry) => n.filename)
    .filter(Boolean);
  return fromNumstat.length > 0
    ? fromNumstat
    : diffs
        .map((d) => d.filePath)
        .filter((filePath): filePath is string => typeof filePath === 'string');
}

function countPackages(filenames: string[]): number {
  const packages = new Set(
    filenames
      .filter((f: string) => f.startsWith('packages/'))
      .map((f: string) => f.split('/')[1]),
  );
  return packages.size;
}

function countAcceptanceCriteria(
  issues: Array<Record<string, unknown>>,
): number {
  return issues.reduce((sum: number, issue: Record<string, unknown>) => {
    const body = String(issue.body ?? '').toLowerCase();
    const matches = body.match(/acceptance criteri[\s\S]*?(?=\n#|\n##|$)/i);
    if (!matches) {
      return sum;
    }
    const checkboxCount = (matches[0].match(/-\s*\[/g) || []).length;
    return sum + Math.max(1, checkboxCount);
  }, 0);
}
