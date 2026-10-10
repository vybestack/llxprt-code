/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { dirname, relative, resolve, sep } from 'node:path';
import type { Rule } from 'eslint';

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow relative imports into another workspace package',
    },
    messages: {
      crossPackage: 'Relative import from another package is not allowed.',
    },
    schema: [],
  },
  create(context) {
    const segments = context.filename.split(sep);
    const packagesIndex = segments.lastIndexOf('packages');
    if (packagesIndex < 0 || packagesIndex + 1 >= segments.length) return {};
    const packagesRoot = segments.slice(0, packagesIndex + 1).join(sep);
    const importerPackage = segments[packagesIndex + 1];

    function check(source: string, node: Rule.Node): void {
      if (!source.startsWith('./') && !source.startsWith('../')) return;
      const target = resolve(dirname(context.filename), source);
      const [targetPackage, ...inside] = relative(packagesRoot, target).split(
        sep,
      );
      if (
        targetPackage !== '..' &&
        targetPackage !== importerPackage &&
        inside.length > 0
      ) {
        context.report({ node, messageId: 'crossPackage' });
      }
    }

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value === 'string') {
          check(node.source.value, node);
        }
      },
      ExportNamedDeclaration(node) {
        if (node.source && typeof node.source.value === 'string') {
          check(node.source.value, node);
        }
      },
      ExportAllDeclaration(node) {
        if (typeof node.source.value === 'string') {
          check(node.source.value, node);
        }
      },
      ImportExpression(node) {
        if (
          node.source.type === 'Literal' &&
          typeof node.source.value === 'string'
        ) {
          check(node.source.value, node);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments[0]?.type === 'Literal' &&
          typeof node.arguments[0].value === 'string'
        ) {
          check(node.arguments[0].value, node);
        }
      },
    };
  },
};

export default rule;
