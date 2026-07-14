/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * getConfig escape-hatch scanner: detects any call to `getConfig()` or read
 * of `.getConfig` in CLI production source so the Config is never reached via
 * an opaque back-door.
 */

import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { GetConfigHit } from './config.ts';
import { getLine, createSourceFile, unwrapParentheses } from './ast-helpers.ts';

function isGetConfigBindingElement(node: ts.Node): node is ts.BindingElement {
  if (!ts.isBindingElement(node)) return false;
  const name = node.name;
  if (ts.isIdentifier(name) && name.text === 'getConfig') return true;
  const propertyName = node.propertyName;
  return (
    propertyName !== undefined &&
    ts.isIdentifier(propertyName) &&
    propertyName.text === 'getConfig'
  );
}

/**
 * Scan for the getConfig escape hatch. Three shapes are forbidden:
 *
 *   1. Property-access call:  `agent.getConfig()` / `x.getConfig()`
 *   2. Bare identifier call:  `getConfig()`
 *   3. Property-access extraction: `const fn = agent.getConfig`
 */
export function scanGetConfigEscapeHatch(filePath: string): GetConfigHit[] {
  let sourceText: string;
  try {
    sourceText = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const sourceFile = createSourceFile(filePath, sourceText);
  const hits: GetConfigHit[] = [];
  const calledPropertyAccesses = new Set<ts.PropertyAccessExpression>();

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callExpr = unwrapParentheses(node.expression);
      // Shape 1: <expr>.getConfig()
      if (
        ts.isPropertyAccessExpression(callExpr) &&
        callExpr.name.text === 'getConfig'
      ) {
        calledPropertyAccesses.add(callExpr);
        hits.push({ line: getLine(sourceFile, node.getStart()) });
      } else if (ts.isIdentifier(callExpr) && callExpr.text === 'getConfig') {
        // Shape 2: bare getConfig()
        hits.push({ line: getLine(sourceFile, node.getStart()) });
      }
    } else if (
      // Shape 3: `agent.getConfig` read WITHOUT being called
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'getConfig' &&
      !calledPropertyAccesses.has(node)
    ) {
      hits.push({ line: getLine(sourceFile, node.getStart()) });
    } else if (isGetConfigBindingElement(node)) {
      hits.push({ line: getLine(sourceFile, node.getStart()) });
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return hits;
}
