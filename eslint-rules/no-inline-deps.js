/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Custom ESLint rule to detect inline dependency arrays in React hooks
 * that should be extracted to variables for better readability and maintainability.
 */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Discourage inline dependency arrays in React hooks',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      inlineDeps:
        'Dependency arrays should be extracted to a variable for better readability. Consider using a descriptive variable name.',
    },
    fixable: null,
    schema: [],
  },
  create(/* _context */) {
    // NotYetImplemented stub - will be implemented in Phase 01a
    return {
      CallExpression(/* _node */) {
        // TODO: Implement detection of inline dependency arrays in:
        // - useEffect
        // - useCallback
        // - useMemo
        // - useLayoutEffect
        // - useImperativeHandle
        //
        // The rule should identify when the dependency array is defined inline
        // and suggest extracting it to a variable with a descriptive name.
      },
    };
  },
};
