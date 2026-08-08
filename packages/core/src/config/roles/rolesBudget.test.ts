/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROLES_DIR = __dirname;

const MAX_ROLES = 10;
const MAX_MEMBERS_PER_ROLE = 12;

interface RoleMemberCount {
  readonly name: string;
  readonly memberCount: number;
}

function countInterfaceMembers(
  sourceText: string,
  fileName: string,
): RoleMemberCount[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const results: RoleMemberCount[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node)) {
      results.push({
        name: node.name.text,
        memberCount: node.members.length,
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return results;
}

/**
 * Parses every non-test .ts file in the roles directory and returns the
 * member count of each declared interface. Counts are derived from the source
 * files at runtime — never hardcoded.
 */
function getRoleMemberCounts(): RoleMemberCount[] {
  const files = readdirSync(ROLES_DIR).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );
  const allCounts: RoleMemberCount[] = [];
  for (const file of files) {
    const sourceText = readFileSync(join(ROLES_DIR, file), 'utf8');
    allCounts.push(...countInterfaceMembers(sourceText, file));
  }
  return allCounts;
}

describe('role interface member budget (issue #2615, REQ-002)', () => {
  const roleCounts = getRoleMemberCounts();

  it(`declares at most ${MAX_ROLES} role interfaces`, () => {
    expect(roleCounts.length).toBeLessThanOrEqual(MAX_ROLES);
  });

  it(`each role interface has at most ${MAX_MEMBERS_PER_ROLE} members`, () => {
    for (const { name, memberCount } of roleCounts) {
      expect(
        memberCount,
        `${name} declares ${memberCount} members (budget ${MAX_MEMBERS_PER_ROLE})`,
      ).toBeLessThanOrEqual(MAX_MEMBERS_PER_ROLE);
    }
  });

  it('parses at least one role interface from the source files', () => {
    expect(roleCounts.length).toBeGreaterThan(0);
  });
});
