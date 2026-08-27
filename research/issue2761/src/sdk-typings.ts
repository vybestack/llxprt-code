/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reads the INSTALLED `@google/genai` declaration file at probe time and extracts
 * the member names of named interfaces, so artifacts can quote machine facts instead
 * of hand-transcribed arrays. P12 (GoogleGenAIOptions / HttpOptions) and P14
 * (model-listing surface) both rely on it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROBE_ROOT } from './harness.ts';

const GENAI_DTS = join(
  PROBE_ROOT,
  'node_modules',
  '@google',
  'genai',
  'dist',
  'genai.d.ts',
);

export interface InterfaceFacts {
  readonly file: string;
  readonly members: string[];
}

/**
 * Locates `interface <name> {` in the installed declaration file and returns the
 * member names declared directly on the interface body. Returns null when the
 * declaration cannot be found.
 */
export function interfaceMembersFromDts(name: string): InterfaceFacts | null {
  let source: string;
  try {
    source = readFileSync(GENAI_DTS, 'utf8');
  } catch {
    return null;
  }

  // The `declare` prefix is optional and index signatures are never member names, so
  // match the plain declaration form.
  const declaration = source.indexOf(`interface ${name} {`);
  if (declaration === -1) {
    return null;
  }
  const open = source.indexOf('{', declaration);
  if (open === -1) {
    return null;
  }

  const body = readBraceBody(source, open);
  if (body === null) {
    return null;
  }
  return { file: GENAI_DTS, members: memberNamesOf(stripComments(body)) };
}

/** Returns the text inside the brace that opens at `open` in `source`. */
function readBraceBody(source: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, i);
      }
    }
  }
  return null;
}

/** Removes `/* *` and `//` comments so they cannot fake member names. */
function stripComments(input: string): string {
  const noBlock = input
    .split('/*')
    .map((part, index) =>
      index === 0 ? part : part.split('*/').slice(1).join('*/'),
    )
    .join('');
  return noBlock
    .split('\n')
    .map((line) => line.split('//')[0])
    .join('\n');
}

/**
 * Member declarations inside the interface body all terminate in `;`. The name is
 * the leading identifier of each such statement at the body's own depth (nested
 * object braces are skipped).
 */
function memberNamesOf(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let segmentStart = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      continue;
    }
    if (ch === ';' && depth === 0) {
      const name = leadingIdentifier(body.slice(segmentStart, i));
      if (name !== null) {
        names.push(name);
      }
      segmentStart = i + 1;
    }
  }
  const tail = leadingIdentifier(body.slice(segmentStart));
  if (tail !== null) {
    names.push(tail);
  }
  return [...new Set(names)];
}

function leadingIdentifier(segment: string): string | null {
  const stripped = segment.trim();
  if (stripped.length === 0) {
    return null;
  }
  const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(stripped);
  return match === null ? null : match[0];
}
