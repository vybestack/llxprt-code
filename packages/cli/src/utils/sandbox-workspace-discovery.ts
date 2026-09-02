/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';

/** One validated, normalized workspace package-root declaration. */
export interface WorkspacePackagePattern {
  readonly source: string;
  readonly pattern: string;
  readonly kind: 'literal' | 'glob';
}

/** Positive package-root declarations and exclusions, before filesystem I/O. */
export interface WorkspacePackageDiscoveryPlan {
  readonly inclusions: readonly WorkspacePackagePattern[];
  readonly exclusions: readonly WorkspacePackagePattern[];
}

const UNSUPPORTED_GLOB_CHARACTERS = new Set(['?', '[', ']', '{', '}', '\\']);
const UNSUPPORTED_EXTGLOB_OPENERS = ['+(', '@(', '!('] as const;
const WORKSPACE_GLOB_GUIDANCE =
  "Supported workspace globs use '*' as a complete segment or a final '**' after a literal directory prefix, for example 'packages/*' or 'tools/**'.";

function workspaceDeclarationEntries(workspaces: unknown): readonly unknown[] {
  if (Array.isArray(workspaces)) return workspaces;
  if (typeof workspaces !== 'object' || workspaces === null) return [];
  const packages = Reflect.get(workspaces, 'packages');
  return Array.isArray(packages) ? packages : [];
}

function invalidWorkspaceGlob(source: string): FatalSandboxError {
  return new FatalSandboxError(
    `Unsupported workspace glob '${source}'. ${WORKSPACE_GLOB_GUIDANCE}`,
  );
}

function containsUnsupportedCharacter(pattern: string): boolean {
  return [...pattern].some((character) =>
    UNSUPPORTED_GLOB_CHARACTERS.has(character),
  );
}

function containsUnsupportedExtglob(pattern: string): boolean {
  return UNSUPPORTED_EXTGLOB_OPENERS.some((opener) => pattern.includes(opener));
}

function containsUnsupportedStar(segments: readonly string[]): boolean {
  return segments.some(
    (segment) => segment.includes('*') && segment !== '*' && segment !== '**',
  );
}

function isLiteralDirectorySegment(segment: string): boolean {
  return (
    segment !== '' && segment !== '.' && segment !== '..' && segment !== '*'
  );
}

function hasInvalidRecursiveGlob(segments: readonly string[]): boolean {
  const recursiveIndex = segments.indexOf('**');
  if (recursiveIndex === -1) return false;
  if (recursiveIndex !== segments.length - 1) return true;
  return !segments.slice(0, recursiveIndex).some(isLiteralDirectorySegment);
}

function assertSupportedGlob(
  source: string,
  pattern: string,
  segments: readonly string[],
  hasGlob: boolean,
): void {
  if (containsUnsupportedCharacter(pattern)) throw invalidWorkspaceGlob(source);
  if (containsUnsupportedExtglob(pattern)) throw invalidWorkspaceGlob(source);
  if (pattern.startsWith('!')) throw invalidWorkspaceGlob(source);
  if (containsUnsupportedStar(segments)) throw invalidWorkspaceGlob(source);
  if (hasInvalidRecursiveGlob(segments)) throw invalidWorkspaceGlob(source);
  if (hasGlob && segments.includes('..')) throw invalidWorkspaceGlob(source);
  if (
    hasGlob &&
    (path.posix.isAbsolute(pattern) || path.win32.isAbsolute(pattern))
  ) {
    throw invalidWorkspaceGlob(source);
  }
}

function normalizeWorkspacePattern(source: string): WorkspacePackagePattern {
  const rawPattern = source.startsWith('!') ? source.slice(1) : source;
  if (rawPattern === '') throw invalidWorkspaceGlob(source);
  const rawSegments = rawPattern.split('/');
  const hasGlob = rawSegments.some(
    (segment) => segment === '*' || segment === '**',
  );
  assertSupportedGlob(source, rawPattern, rawSegments, hasGlob);
  return {
    source,
    pattern: path.posix.normalize(rawPattern),
    kind: hasGlob ? 'glob' : 'literal',
  };
}

/**
 * Validates workspace declaration syntax without reading the filesystem or
 * invoking a container engine.
 */
export function planWorkspacePackageDiscovery(
  workspaces: unknown,
): WorkspacePackageDiscoveryPlan {
  const inclusions: WorkspacePackagePattern[] = [];
  const exclusions: WorkspacePackagePattern[] = [];
  for (const entry of workspaceDeclarationEntries(workspaces)) {
    if (typeof entry !== 'string' || entry === '') continue;
    const planned = normalizeWorkspacePattern(entry);
    if (entry.startsWith('!')) {
      exclusions.push(planned);
    } else {
      inclusions.push(planned);
    }
  }
  return { inclusions, exclusions };
}
