/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { RoleViolation } from './types.js';
import { walkTsFiles } from './program.js';

/**
 * Members matching this pattern are service locators (REQ-004) and must never
 * appear on a role interface in packages/core/src/config/roles/.
 */
const SERVICE_LOCATOR_RE =
  /^get[A-Z].*(Manager|Service|Registry|Client|Factory|Engine)$/;

/** Extracts the textual name of an interface/type member. */
function memberName(
  member: ts.TypeElement | ts.ClassElement,
): string | undefined {
  if (member.name === undefined) return undefined;
  if (ts.isIdentifier(member.name)) return member.name.text;
  if (ts.isStringLiteral(member.name)) return member.name.text;
  if (
    ts.isComputedPropertyName(member.name) &&
    ts.isStringLiteral(member.name.expression)
  ) {
    return member.name.expression.text;
  }
  return undefined;
}

/** Collects service-locator member names declared on interface members. */
function collectViolatingMembers(
  declaration: ts.InterfaceDeclaration | ts.TypeLiteralNode,
): string[] {
  const violations: string[] = [];
  for (const member of declaration.members) {
    const name = memberName(member);
    if (name && SERVICE_LOCATOR_RE.test(name)) violations.push(name);
  }
  return violations;
}

function scanFile(sourceFile: ts.SourceFile, file: string): RoleViolation[] {
  const violations: RoleViolation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
      for (const member of collectViolatingMembers(node)) {
        violations.push({ file, member });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return violations;
}

/**
 * Finds role interfaces in packages/core/src/config/roles/ that declare
 * service-locator accessors. Roles do not exist yet in this phase, so this
 * returns empty against the real repo today; it enforces REQ-004 once the
 * migration creates the roles directory.
 */
export function findRoleViolations(root: string): RoleViolation[] {
  const rolesDir = join(root, 'packages/core/src/config/roles');
  const violations: RoleViolation[] = [];
  for (const file of walkTsFiles(rolesDir)) {
    const text = readSafe(file);
    if (text === undefined) continue;
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    violations.push(...scanFile(sourceFile, file));
  }
  return violations;
}

function readSafe(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}
