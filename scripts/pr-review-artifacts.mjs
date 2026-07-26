/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

async function readWithConcurrency(items, concurrencyLimit, asyncFn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await asyncFn(items[index]);
      } catch (error) {
        results[index] = {
          error: error instanceof Error ? error.message : String(error),
          filePath: items[index],
        };
      }
    }
  };
  const workerCount = Math.min(concurrencyLimit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function readArtifacts(reviewDir) {
  const prPath = path.join(reviewDir, 'pr.json');
  try {
    await fs.access(prPath);
  } catch {
    throw new Error(`Required artifact missing: ${prPath}`);
  }
  const pr = JSON.parse(await fs.readFile(prPath, 'utf8'));
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

async function readIssueFiles(reviewDir) {
  const issuesDir = path.join(reviewDir, 'issues');
  const files = await fs.readdir(issuesDir).catch(() => []);
  const issueFiles = files.filter((file) => file.endsWith('.json'));
  const results = await readWithConcurrency(issueFiles, 8, async (file) => ({
    filePath: file,
    issue: JSON.parse(await fs.readFile(path.join(issuesDir, file), 'utf8')),
  }));
  const issues = collectArtifactReads(results, 'issue');
  if (issueFiles.length > 0 && issues.length === 0) {
    throw new Error(
      `All ${issueFiles.length} issue file(s) failed to parse in ${issuesDir}`,
    );
  }
  return issues.sort((a, b) => a.number - b.number);
}

async function readDiffFiles(reviewDir) {
  const diffsDir = path.join(reviewDir, 'diffs');
  const manifestPath = path.join(reviewDir, 'diff-manifest.txt');
  const manifest = await parseDiffManifest(manifestPath);
  const files = await fs.readdir(diffsDir).catch(() => []);
  const diffFiles = files.filter((file) => file.endsWith('.diff'));
  const results = await readWithConcurrency(diffFiles, 8, async (file) => ({
    filePath: file,
    diff: {
      filePath: resolveOriginalPath(file, manifest),
      safeName: file,
      content: await fs.readFile(path.join(diffsDir, file), 'utf8'),
    },
  }));
  const diffs = collectArtifactReads(results, 'diff');
  if (diffFiles.length > 0 && diffs.length === 0) {
    throw new Error(
      `All ${diffFiles.length} diff file(s) failed to read in ${diffsDir}`,
    );
  }
  return diffs;
}

function collectArtifactReads(results, valueKey) {
  const values = [];
  for (const result of results) {
    if ('error' in result) {
      console.error(`Failed to read ${result.filePath}: ${result.error}`);
    } else {
      values.push(result[valueKey]);
    }
  }
  return values;
}

export async function parseDiffManifest(manifestPath) {
  let raw;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch {
    return null;
  }
  const map = new Map();
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

export function resolveOriginalPath(safeDiffName, manifest) {
  if (manifest && manifest.has(safeDiffName)) {
    return manifest.get(safeDiffName);
  }
  return safeDiffName.replace(/__/g, '/').replace(/\.diff$/, '');
}

async function readNumstat(reviewDir) {
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
        filename,
      };
    });
}

export function buildArtifactContext(pr, issues, diffs, numstat) {
  const totalAdditions = numstat.reduce((sum, n) => sum + n.additions, 0);
  const totalDeletions = numstat.reduce((sum, n) => sum + n.deletions, 0);
  const changedFiles = pr.changedFiles ?? numstat.length;
  const changedFilePaths = deriveChangedFilePaths(numstat, diffs);
  return {
    prContext: {
      number: pr.number,
      title: pr.title,
      author: pr.author?.login,
      body: pr.body,
      baseRefName: pr.baseRefName,
      headRefName: pr.headRefName,
      additions: pr.additions ?? totalAdditions,
      deletions: pr.deletions ?? totalDeletions,
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

function deriveChangedFilePaths(numstat, diffs) {
  const fromNumstat = numstat.map((n) => n.filename).filter(Boolean);
  return fromNumstat.length > 0
    ? fromNumstat
    : diffs.map((d) => d.filePath).filter(Boolean);
}

function countPackages(filenames) {
  const packages = new Set(
    filenames
      .filter((f) => f.startsWith('packages/'))
      .map((f) => f.split('/')[1]),
  );
  return packages.size;
}

function countAcceptanceCriteria(issues) {
  return issues.reduce((sum, issue) => {
    const body = String(issue.body ?? '').toLowerCase();
    const matches = body.match(/acceptance criteri[\s\S]*?(?=\n#|\n##|$)/i);
    if (!matches) {
      return sum;
    }
    const checkboxCount = (matches[0].match(/-\s*\[/g) || []).length;
    return sum + Math.max(1, checkboxCount);
  }, 0);
}
