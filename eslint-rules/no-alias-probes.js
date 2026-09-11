/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Custom ESLint rule to reject alias coalescing/property probing.
 *
 * Flags `a.propOne ?? a.propTwo` / `a.propOne || a.propTwo` shapes where both
 * operands read the same object and the two property names are spelling
 * variants of each other (equal after normalization). Code should use one
 * canonical property name instead of probing for legacy spellings inline.
 */

const ALIAS_WORD_FOLDS = new Map([
  ['old', 'new'],
  ['behaviour', 'behavior'],
  ['behaviours', 'behaviors'],
  ['colour', 'color'],
  ['colours', 'colors'],
  ['normalise', 'normalize'],
  ['normalised', 'normalized'],
  ['normalisation', 'normalization'],
  ['analyse', 'analyze'],
  ['analysed', 'analyzed'],
  ['catalogue', 'catalog'],
]);

function propertyNameWords(name) {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_$\s-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function normalizePropertyName(name) {
  return propertyNameWords(name)
    .map((word) => ALIAS_WORD_FOLDS.get(word) ?? word)
    .join('');
}

function normalizeObjectText(text) {
  // Treat `x?.cfg` and `x.cfg` (and incidental whitespace) as the same object.
  return text.replace(/\s+/g, '').replace(/\?\./g, '.');
}

/**
 * Structured allowlist of boundary exceptions. Each entry names one file
 * (repo-relative, exact path, no globs) where the rule's heuristic is known
 * to fire on legitimate decoding, plus the owning team, the reason, and the
 * condition for removing the entry. Mirrored in dev-docs/naming-standard.md.
 * Inline eslint-disable comments are NOT the mechanism for these; entries
 * here are the only file-level exemptions.
 */
export const BOUNDARY_EXCEPTIONS = Object.freeze([
  Object.freeze({
    file: 'packages/providers/src/auth/proxy/proxy-oauth-adapter.ts',
    owner: 'providers',
    reason:
      'Third-party OAuth proxy response: decode both wire spellings once at this boundary',
    removalCondition: 'Never (third-party wire format)',
  }),
  Object.freeze({
    file: 'packages/providers/src/openai-vercel/errors.ts',
    owner: 'providers',
    reason:
      'Third-party API error payload: decode both wire spellings once at this boundary',
    removalCondition: 'Never (third-party wire format)',
  }),
  Object.freeze({
    file: 'packages/providers/src/utils/mediaDiagnostics.ts',
    owner: 'providers',
    reason: 'Gemini wire format: decode both spellings once at this boundary',
    removalCondition: 'Never (third-party wire format)',
  }),
  Object.freeze({
    file: 'packages/cli/src/utils/sandbox-containers.ts',
    owner: 'cli',
    reason:
      'NO_PROXY/no_proxy: both spellings are set and honored by the proxy ecosystem',
    removalCondition: 'Never (third-party env convention)',
  }),
  Object.freeze({
    file: 'packages/cli/src/utils/sandbox-seatbelt.ts',
    owner: 'cli',
    reason:
      'NO_PROXY/no_proxy: both spellings are set and honored by the proxy ecosystem',
    removalCondition: 'Never (third-party env convention)',
  }),
  Object.freeze({
    file: 'packages/tools/src/tools/apply-patch-analysis.ts',
    owner: 'tools',
    reason:
      'Rule false positive: oldFileName/newFileName are distinct semantic fields (source vs target hunk path), not spelling variants',
    removalCondition:
      'Never (heuristic limit; revisit if the rule gains semantic awareness)',
  }),
]);

/**
 * Returns true when the linted filename matches a BOUNDARY_EXCEPTIONS entry,
 * either exactly (repo-relative) or as a path suffix, so the same rule works
 * regardless of the workspace root prefix in the reported filename.
 */
function isBoundaryException(filename) {
  const normalized = filename.replace(/\\/g, '/');
  return BOUNDARY_EXCEPTIONS.some(
    (entry) =>
      normalized === entry.file || normalized.endsWith('/' + entry.file),
  );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Reject alias coalescing where both operands are spelling variants of the same property on the same object',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      aliasProbe:
        'Alias probe: {{left}} and {{right}} are spelling variants of the same property; use one canonical name (see dev-docs/naming-standard.md).',
    },
    fixable: null,
    schema: [],
  },
  create(context) {
    const sourceCode = context.getSourceCode();

    if (isBoundaryException(context.filename)) {
      return {};
    }

    function unwrapChain(node) {
      if (node.type === 'ChainExpression') {
        return unwrapChain(node.expression);
      }
      return node.type === 'MemberExpression' ? node : null;
    }

    function getPropertyName(memberExpression) {
      const property = memberExpression.property;
      if (!memberExpression.computed) {
        return property.type === 'Identifier' ? property.name : null;
      }
      if (
        property.type === 'Literal' &&
        (typeof property.value === 'string' ||
          typeof property.value === 'number')
      ) {
        return String(property.value);
      }
      if (
        property.type === 'TemplateLiteral' &&
        property.expressions.length === 0 &&
        property.quasis.length === 1
      ) {
        return property.quasis[0].value.cooked;
      }
      return null; // Dynamic access: cannot compare names statically.
    }

    function isAliasProbe(left, right) {
      const leftProperty = getPropertyName(left);
      const rightProperty = getPropertyName(right);
      if (leftProperty === null || rightProperty === null) return false;
      // Identical names are redundant code, not an alias probe.
      if (leftProperty === rightProperty) return false;
      const leftObject = normalizeObjectText(sourceCode.getText(left.object));
      const rightObject = normalizeObjectText(sourceCode.getText(right.object));
      if (leftObject !== rightObject) return false;
      return (
        leftProperty.toLowerCase() === rightProperty.toLowerCase() ||
        normalizePropertyName(leftProperty) ===
          normalizePropertyName(rightProperty)
      );
    }

    return {
      LogicalExpression(node) {
        if (node.operator !== '||' && node.operator !== '??') return;
        const left = unwrapChain(node.left);
        const right = unwrapChain(node.right);
        if (!left || !right) return;
        if (isAliasProbe(left, right)) {
          context.report({
            node,
            messageId: 'aliasProbe',
            data: {
              left: sourceCode.getText(left),
              right: sourceCode.getText(right),
            },
          });
        }
      },
    };
  },
};
