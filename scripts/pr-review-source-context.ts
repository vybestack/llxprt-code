/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { SourceContext } from './pr-review-evidence.ts';

type ReadSource = (revision: string, file: string) => string | null;
interface Diff {
  filePath: string;
  content: string;
}

function enclosingKey(lines: string[], at: number): number | undefined {
  for (let index = at; index >= 0; index--) {
    if (
      /^\s*(?:export |async |function |class |["'](?:include|exclude)["']\s*:)/.test(
        lines[index] ?? '',
      )
    )
      return index;
  }
  return undefined;
}

function excerpt(diff: string, source: string, side: number): string {
  const lines = source.split('\n');
  const keys = new Set<number>();
  const nearby = new Set<number>();
  for (const hunk of diff.matchAll(/^@@ -(\d+)(?:,\d+)? \+(\d+)/gm)) {
    const at = Math.min(lines.length - 1, Number(hunk[side]) - 1);
    for (
      let index = Math.max(0, at - 4);
      index < Math.min(lines.length, at + 8);
      index++
    )
      nearby.add(index);
    const key = enclosingKey(lines, at);
    if (key !== undefined) keys.add(key);
  }
  let content = '';
  // Enclosing keys precede nearby lines so truncation cannot drop their meaning.
  for (const index of [
    ...keys,
    ...[...nearby].filter((index) => !keys.has(index)),
  ]) {
    const line = `${index + 1}: ${lines[index]}\n`;
    if (Buffer.byteLength(content + line) > 1600) break;
    content += line;
  }
  return content;
}

function survivingExport(
  target: string,
  head: string,
  readSource: ReadSource,
): SourceContext[] {
  for (const file of [target + '.ts', target + '.tsx', target + '/index.ts']) {
    const source = readSource(head, file);
    if (source !== null) {
      const lines = source.split('\n');
      const at = Math.max(
        0,
        lines.findIndex((line) =>
          /^export (?:class|function|const)/.test(line),
        ),
      );
      return [
        {
          revision: head,
          path: file,
          content: lines
            .slice(at, at + 8)
            .join('\n')
            .slice(0, 1000),
        },
      ];
    }
  }
  return [];
}

function barrelContext(
  diff: Diff,
  head: string,
  readSource: ReadSource,
): SourceContext[] {
  if (!diff.content.includes('+++ /dev/null')) return [];
  return [
    ...diff.content.matchAll(/^-export .* from ['"]([^'"]+)['"]/gm),
  ].flatMap((match) => {
    if (!match[1].startsWith('.')) return [];
    const target = path.posix.normalize(
      path.posix.join(
        path.posix.dirname(diff.filePath),
        match[1].replace(/\.js$/, ''),
      ),
    );
    return target.startsWith('../')
      ? []
      : survivingExport(target, head, readSource);
  });
}

export function collectSourceContext(
  diffs: Diff[],
  base: string,
  head: string,
  readSource: ReadSource,
): Record<string, SourceContext[]> {
  const result: Record<string, SourceContext[]> = {};
  for (const diff of diffs.filter((diff) =>
    /\.(ts|tsx|json)$/.test(diff.filePath),
  )) {
    const revisions: Array<[number, string]> = [
      [1, base],
      [2, head],
    ];
    const records = revisions.flatMap(([side, revision]) => {
      const source = readSource(revision, diff.filePath);
      return source === null
        ? []
        : [
            {
              revision,
              path: diff.filePath,
              content: excerpt(diff.content, source, side),
            },
          ];
    });
    result[diff.filePath] = [
      ...records,
      ...barrelContext(diff, head, readSource),
    ];
  }
  return result;
}

async function main(): Promise<void> {
  const base = z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .parse(process.env.MERGE_BASE);
  const head = z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .parse(process.env.PR_HEAD_SHA);
  const dir = process.env.REVIEW_DIR ?? 'review';
  const manifest = await fs.readFile(
    path.join(dir, 'diff-manifest.txt'),
    'utf8',
  );
  const diffs = await Promise.all(
    manifest
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(async (line) => {
        const [safe, filePath] = line.split('\t');
        if (!safe || path.basename(safe) !== safe || !filePath)
          throw new Error('Invalid diff manifest');
        return {
          filePath,
          content: await fs.readFile(path.join(dir, 'diffs', safe), 'utf8'),
        };
      }),
  );
  const context = collectSourceContext(diffs, base, head, (revision, file) => {
    try {
      return execFileSync('git', ['show', `${revision}:${file}`], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  });
  await fs.writeFile(
    path.join(dir, 'source-context.json'),
    JSON.stringify(context),
  );
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await main();
