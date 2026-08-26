/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for issue #3019 (AB2): the `github` tool schema/description stops
 * implying `number` is universal.
 *
 * The schema ships in every system prompt, so its `properties` must declare
 * `threadId` (the parameter `pr.resolve-thread` actually requires) and must
 * not present `number` as universal. The assertions here are structural —
 * they read the declared schema via `in`-operator narrowing, not substring
 * matches on prose that would pass on main before the fix.
 *
 * @plan issue-3019-github-unknown-parameter
 * @requirement AB2
 * @issue 3019
 */

import { describe, it, expect } from 'bun:test';
import { GithubTool, type GitHubBrokerClient } from './github.js';

function stubClient(): GitHubBrokerClient {
  return {
    async runOperation() {
      return { ok: true };
    },
  };
}

/**
 * True when `container` declares `name` as its OWN property.
 *
 * `in` is what this PR removes from the broker's unknown-key check, because
 * it walks the prototype chain — a schema that inherited `properties`, or a
 * property that inherited `description`, would read as declared here. The
 * type predicate supplies the narrowing that `in` would otherwise be needed
 * for, so the schema reads stay free of type assertions.
 */
function declaresOwn<K extends string>(
  container: object,
  name: K,
): container is Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(container, name);
}

/**
 * Reads a single declared property's `type` and `description` — own
 * properties only, no type assertions, no `any`. Returns null when the
 * property is absent or the schema shape is unexpected.
 */
interface PropertyDescription {
  readonly type: unknown;
  readonly description: string;
}

function propertyTypeAndDescription(
  tool: GithubTool,
  name: string,
): PropertyDescription | null {
  const schema: unknown = tool.parameterSchema;
  if (typeof schema !== 'object' || schema === null) return null;
  if (!declaresOwn(schema, 'properties')) return null;
  const properties = schema.properties;
  if (typeof properties !== 'object' || properties === null) return null;
  if (!declaresOwn(properties, name)) return null;
  const prop = properties[name];
  if (typeof prop !== 'object' || prop === null) return null;
  const type = declaresOwn(prop, 'type') ? prop.type : undefined;
  const description =
    declaresOwn(prop, 'description') && typeof prop.description === 'string'
      ? prop.description
      : '';
  return { type, description };
}

function requirePropertyDescription(
  property: PropertyDescription | null,
): PropertyDescription {
  if (property === null) {
    throw new Error('expected a declared schema property');
  }
  return property;
}

describe('issue #3019 (AB2): github tool documents per-operation params', () => {
  /**
   * Structural: `threadId` must be a declared property with `type: 'string'`,
   * and its description must point back to `pr.reviews` as the source of the
   * thread node id. On main `threadId` is not declared at all, so this fails
   * there.
   *
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB2
   * @issue 3019
   */

  it('declares threadId as a string property sourced from pr.reviews', () => {
    const tool = new GithubTool(stubClient());
    const threadId = propertyTypeAndDescription(tool, 'threadId');
    expect(threadId).not.toBeNull();
    const declaredThreadId = requirePropertyDescription(threadId);
    expect(declaredThreadId.type).toBe('string');
    expect(declaredThreadId.description).toContain('pr.reviews');
  });

  /**
   * Structural: the `number` property description must explicitly name
   * `pr.resolve-thread` as an operation that does not take `number`. On main
   * the description is "Issue or pull request number, for operations that
   * take one." with no mention of `pr.resolve-thread`.
   *
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB2
   * @issue 3019
   */

  it('number schema description names pr.resolve-thread as not taking number', () => {
    const tool = new GithubTool(stubClient());
    const numberProp = propertyTypeAndDescription(tool, 'number');
    expect(numberProp).not.toBeNull();
    const declaredNumber = requirePropertyDescription(numberProp);
    expect(declaredNumber.description.length).toBeGreaterThan(0);
    expect(declaredNumber.description).toContain('pr.resolve-thread');
  });

  /**
   * Prose assertion pinning the per-operation rejection rule in the Notes
   * section, specific enough to fail on main (which has no such rule). The
   * structural assertions above cannot cover a rule stated in free text.
   *
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB2
   * @issue 3019
   */
  it('description states operations reject parameters they do not accept', () => {
    const tool = new GithubTool(stubClient());
    // Collapse whitespace so the assertion is robust to line wrapping in the
    // template literal; the clause itself is what is pinned.
    const normalized = tool.description.replace(/\s+/g, ' ');
    expect(normalized).toContain(
      'an operation rejects any parameter it does not accept and names the accepted ones in the error',
    );
  });
});
