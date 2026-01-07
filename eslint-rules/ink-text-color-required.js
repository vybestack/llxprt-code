/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Custom ESLint rule to enforce theme consistency for Ink Text components.
 * Ensures all Text components from the Ink library use theme colors appropriately.
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce that Ink Text components have a color prop',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      missingColor:
        'Text component must have a color prop. Use Colors.Foreground, Colors.DimComment, semantic colors (e.g., theme.text.primary), or a specific theme color. Avoid using the dimColor prop due to TMux/Linux rendering issues.',
      dimColorNotAllowed:
        'Do not use the dimColor prop on Text components due to TMux/Linux rendering issues. Use Colors.DimComment for dimmed text instead.',
    },
    fixable: null,
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        // Check if this is a Text component
        const tagName = node.name;
        if (!tagName) return;

        // Handle both simple names and JSXMemberExpressions (e.g., Ink.Text)
        const componentName =
          tagName.type === 'JSXIdentifier' ? tagName.name : null;

        if (componentName !== 'Text') {
          return;
        }

        // Check for dimColor prop - report error if found
        const hasDimColorProp = node.attributes.some((attr) => {
          if (
            attr.type === 'JSXAttribute' &&
            attr.name.type === 'JSXIdentifier'
          ) {
            return attr.name.name === 'dimColor';
          }
          return false;
        });

        if (hasDimColorProp) {
          context.report({
            node,
            messageId: 'dimColorNotAllowed',
          });
        }

        // Check for color prop - report error if missing
        const hasColorProp = node.attributes.some((attr) => {
          if (
            attr.type === 'JSXAttribute' &&
            attr.name.type === 'JSXIdentifier'
          ) {
            return attr.name.name === 'color';
          }
          return false;
        });

        if (!hasColorProp) {
          context.report({
            node,
            messageId: 'missingColor',
          });
        }
      },
    };
  },
};
