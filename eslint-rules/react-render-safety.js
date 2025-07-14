/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Custom ESLint rule to detect potential React render-time issues
 * that can cause infinite loops or performance problems.
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Detect React patterns that can cause infinite loops or performance issues',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      arrayMutation:
        'Do not mutate arrays during render. Use spread operator or other immutable operations.',
      renderTimeSetState:
        'Do not call setState during render. Move this to useEffect or event handler.',
      inlineObjectProp:
        'Inline object as prop will cause unnecessary re-renders. Use useMemo or move outside component.',
      inlineArrayProp:
        'Inline array as prop will cause unnecessary re-renders. Use useMemo or move outside component.',
      inlineFunctionProp:
        'Inline function as prop will cause unnecessary re-renders. Use useCallback or move outside component.',
      unstableDependency:
        'Object or array in useEffect dependencies should be memoized to prevent infinite loops.',
    },
    fixable: null,
    schema: [],
  },
  create(context) {
    let inComponentBody = false;
    let inUseEffect = false;
    let inUseCallback = false;
    let inUseMemo = false;

    function isReactComponent(node) {
      // Simple heuristic: function starting with capital letter or using hooks
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        const parent = node.parent;
        if (
          parent &&
          parent.type === 'VariableDeclarator' &&
          parent.id &&
          parent.id.name
        ) {
          return /^[A-Z]/.test(parent.id.name);
        }
        if (node.id && node.id.name) {
          return /^[A-Z]/.test(node.id.name);
        }
      }
      return false;
    }

    function checkArrayMutation(node) {
      if (inComponentBody && !inUseEffect && !inUseCallback && !inUseMemo) {
        if (
          node.callee &&
          node.callee.property &&
          [
            'push',
            'pop',
            'shift',
            'unshift',
            'splice',
            'sort',
            'reverse',
          ].includes(node.callee.property.name)
        ) {
          context.report({
            node,
            messageId: 'arrayMutation',
          });
        }
      }
    }

    function checkRenderTimeSetState(node) {
      if (inComponentBody && !inUseEffect && !inUseCallback && !inUseMemo) {
        if (
          node.callee &&
          node.callee.name &&
          /^set[A-Z]/.test(node.callee.name)
        ) {
          // Check if it's not inside a function (event handler)
          let parent = node.parent;
          let insideFunction = false;
          while (parent && parent !== context.getScope().block) {
            if (
              parent.type === 'ArrowFunctionExpression' ||
              parent.type === 'FunctionExpression'
            ) {
              insideFunction = true;
              break;
            }
            parent = parent.parent;
          }
          if (!insideFunction) {
            context.report({
              node,
              messageId: 'renderTimeSetState',
            });
          }
        }
      }
    }

    function checkInlineProps(node) {
      if (
        node.type === 'JSXElement' &&
        node.openingElement &&
        node.openingElement.attributes
      ) {
        node.openingElement.attributes.forEach((attr) => {
          if (attr.type === 'JSXAttribute' && attr.value) {
            // Check for inline objects
            if (
              attr.value.type === 'JSXExpressionContainer' &&
              attr.value.expression
            ) {
              const expr = attr.value.expression;

              // Inline object literal
              if (expr.type === 'ObjectExpression') {
                context.report({
                  node: expr,
                  messageId: 'inlineObjectProp',
                });
              }

              // Inline array literal
              if (expr.type === 'ArrayExpression') {
                context.report({
                  node: expr,
                  messageId: 'inlineArrayProp',
                });
              }

              // Inline arrow function (not from hooks)
              if (
                expr.type === 'ArrowFunctionExpression' &&
                attr.name &&
                attr.name.name &&
                attr.name.name.startsWith('on')
              ) {
                context.report({
                  node: expr,
                  messageId: 'inlineFunctionProp',
                });
              }
            }
          }
        });
      }
    }

    return {
      // Track when we're in a component
      FunctionDeclaration(node) {
        if (isReactComponent(node)) {
          inComponentBody = true;
        }
      },
      'FunctionDeclaration:exit'(node) {
        if (isReactComponent(node)) {
          inComponentBody = false;
        }
      },
      FunctionExpression(node) {
        if (isReactComponent(node)) {
          inComponentBody = true;
        }
      },
      'FunctionExpression:exit'(node) {
        if (isReactComponent(node)) {
          inComponentBody = false;
        }
      },
      ArrowFunctionExpression(node) {
        if (isReactComponent(node)) {
          inComponentBody = true;
        }
      },
      'ArrowFunctionExpression:exit'(node) {
        if (isReactComponent(node)) {
          inComponentBody = false;
        }
      },

      // Track hook usage
      CallExpression(node) {
        if (node.callee && node.callee.name) {
          if (node.callee.name === 'useEffect') {
            inUseEffect = true;
          } else if (node.callee.name === 'useCallback') {
            inUseCallback = true;
          } else if (node.callee.name === 'useMemo') {
            inUseMemo = true;
          }
        }

        // Check for array mutations
        checkArrayMutation(node);

        // Check for setState during render
        checkRenderTimeSetState(node);
      },
      'CallExpression:exit'(node) {
        if (node.callee && node.callee.name) {
          if (node.callee.name === 'useEffect') {
            inUseEffect = false;
          } else if (node.callee.name === 'useCallback') {
            inUseCallback = false;
          } else if (node.callee.name === 'useMemo') {
            inUseMemo = false;
          }
        }
      },

      // Check JSX props
      JSXElement(node) {
        if (inComponentBody) {
          checkInlineProps(node);
        }
      },
    };
  },
};
