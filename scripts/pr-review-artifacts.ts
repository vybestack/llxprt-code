/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const recordSchema = z.record(z.unknown());

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
      try {
        results[index] = await asyncFn(item);
      } catch (error) {
        results[index] = {
          error: error instanceof Error ? error.message : String(error),
          filePath: String(item),
        };
      }
    }
  };
  const workerCount = Math.min(concurrencyLimit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function readArtifacts(
  reviewDir: string,
): Promise<Record<string, unknown>> {
  const prPath = path.join(reviewDir, 'pr.json');
  try {
    await fs.access(prPath);
  } catch {
    throw new Error(`Required artifact missing: ${prPath}`);
  }
  const pr = recordSchema.parse(JSON.parse(await fs.readFile(prPath, 'utf8')));
  const issues = await readIssueFiles(reviewDir);
  if (issues.length === 0) {
    throw new Error(
      'No linked issue files found in review/issues — the issue_gate should have blocked this PR. Infrastructure problem.',
    );
  }
  const diffs = await readDiffFiles(reviewDir);
  const numstat = await readNumstat(reviewDir);
  return buildArtifactContext(pr, issues, diffs, numstat);
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
      issue: JSON.parse(await fs.readFile(path.join(issuesDir, file), 'utf8')),
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
        content: await fs.readFile(path.join(diffsDir, file), 'utf8'),
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
      console.error(`Failed to read ${result.filePath}: ${result.error}`);
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
  return {
    prContext: {
      number: pr.number,
      title: pr.title,
      author: prAuthor.success ? prAuthor.data.login : undefined,
      body: pr.body,
      baseRefName: pr.baseRefName,
      headRefName: pr.headRefName,
      additions: Number(pr.additions ?? totalAdditions),
      deletions: Number(pr.deletions ?? totalDeletions),
      changedFiles,
      commits: pr.commits,
    },
    issues,
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
