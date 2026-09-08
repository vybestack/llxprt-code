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

import { assertNotNull } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect } from 'bun:test';
import { GithubTool, type GitHubBrokerClient } from './github.js';
import { validateGithubOpParams } from './github-ops.js';

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
  assertNotNull(property, 'expected a declared schema property');
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

/**
 * Issue #3407: a rejected parameter now names the operation that DOES accept
 * it. The reporter watched an agent retry the identical rejected
 * `issue.create` + `type` call over and over because the message listed what
 * `issue.create` accepts but never said where `type` belongs. The tool is the
 * only sanctioned GitHub interface inside the sandbox, so the rejection has
 * to carry the recovery path itself.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-4
 * @issue 3407
 */
describe('issue #3407: rejected parameters name the operation that accepts them', () => {
  /**
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-4
   * @issue 3407
   */
  it('issue.create still REJECTS type and points at issue.edit', () => {
    const message = validateGithubOpParams('issue.create', {
      title: 'A new issue',
      type: 'Bug',
    });
    // The op must NOT start accepting `type`: gh issue create has no --type.
    expect(message).not.toBeNull();
    if (message === null) return;
    expect(message).toContain('unknown parameter "type"');
    // ...and it must say where the parameter belongs, and that it is a
    // post-creation step rather than something to retry on issue.create.
    expect(message).toContain('issue.edit');
    expect(message.toLowerCase()).toContain('after creation');
  });

  /**
   * The redirect is computed from the catalog, so it is not a hand-written
   * special case for `type` alone.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-4
   * @issue 3407
   */
  it('names the accepting operations for any misplaced parameter', () => {
    const message = validateGithubOpParams('issue.create', {
      title: 'A new issue',
      number: 42,
    });
    expect(message).not.toBeNull();
    if (message === null) return;
    expect(message).toContain('unknown parameter "number"');
    expect(message).toContain('issue.view');
    expect(message).toContain('pr.ready');
  });

  /**
   * A parameter no operation accepts gets no redirect clause — and no stray
   * trailing whitespace where the clause would have gone.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-4
   * @issue 3407
   */
  it('omits the redirect entirely for a parameter no operation accepts', () => {
    const message = validateGithubOpParams('issue.create', {
      title: 'A new issue',
      bogus: true,
    });
    expect(message).not.toBeNull();
    if (message === null) return;
    expect(message).not.toContain('That parameter is accepted by');
    expect(message).toBe(message.trim());
  });
});

/**
 * Issue #3407: the published `type` parameter description must not read as
 * though `issue.create` might take it.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-4
 * @issue 3407
 */
/**
 * Issue #3407: GitHub negates a qualifier with a leading dash (`-label:bug`),
 * and this tool documents that syntax, but the generic leading-dash guard
 * rejected it. The guard never restricted anything: `-label:bug` was refused
 * while the semantically identical `is:open -label:bug` passed, so it blocked
 * the documented form and nothing else. Three separate model evaluations hit
 * the rejection and each worked around it by reordering the query.
 *
 * It is safe to allow: `search` reaches gh as the value of `--search`, never
 * as a bare token, and `query` is tokenized and emitted after a `--` option
 * terminator.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-10
 * @issue 3407
 */
describe('issue #3407: search qualifiers may be negated with a leading dash', () => {
  /**
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-10
   * @issue 3407
   */
  it('accepts a leading exclusion in issue.list search and in search queries', () => {
    expect(
      validateGithubOpParams('issue.list', { search: '-label:bug' }),
    ).toBeNull();
    expect(
      validateGithubOpParams('search.issues', { query: '-label:bug' }),
    ).toBeNull();
    expect(
      validateGithubOpParams('search.prs', { query: '-label:bug' }),
    ).toBeNull();
    // The form that already worked must keep working.
    expect(
      validateGithubOpParams('issue.list', { search: 'is:open -label:bug' }),
    ).toBeNull();
  });

  /**
   * The relaxation is scoped to search queries. Flag-injection defence still
   * applies to parameters that can reach gh as bare tokens.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-10
   * @issue 3407
   */
  it('still rejects a leading dash on non-query string parameters', () => {
    expect(
      validateGithubOpParams('issue.create', { title: '--malicious' }),
    ).toContain("must not begin with '-'");
    expect(
      validateGithubOpParams('run.list', { branch: '--malicious' }),
    ).toContain("must not begin with '-'");
  });

  /**
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-10
   * @issue 3407
   */
  it('still rejects a non-string search query', () => {
    expect(validateGithubOpParams('issue.list', { search: 42 })).toContain(
      'must be a string',
    );
  });
});

describe('issue #3407: the type parameter description states the create/edit split', () => {
  /**
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-4
   * @issue 3407
   */
  it('says type is set after creation via issue.edit, not on issue.create', () => {
    const tool = new GithubTool(stubClient());
    const typeProp = propertyTypeAndDescription(tool, 'type');
    expect(typeProp).not.toBeNull();
    if (typeProp === null) return;
    expect(typeProp.description).toContain('issue.edit');
    expect(typeProp.description).toContain('issue.create');
    // The distinguishing claim: it is a POST-creation step. A description
    // that merely mentions issue.edit passed before this fix.
    expect(typeProp.description.toLowerCase()).toContain('after');
  });
});
