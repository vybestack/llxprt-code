/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for issue #3019 (AB2): the `github` tool schema/description stops
 * implying `number` is universal.
 *
 * The description is shipped in every system prompt, so it must state that
 * parameters are per-operation, that an operation rejects parameters it does
 * not accept and names them, and that pr.resolve-thread is addressed by
 * threadId alone. The `number` property schema must likewise make clear it
 * only applies to operations that accept it.
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
 * Reads the `number` property description from the tool's declared schema.
 * Narrows `unknown` without type assertions; returns '' when absent.
 */
function numberSchemaDescription(tool: GithubTool): string {
  const schema: unknown = tool.parameterSchema;
  if (typeof schema !== 'object' || schema === null) return '';
  if (!('properties' in schema)) return '';
  const properties = schema.properties;
  if (typeof properties !== 'object' || properties === null) return '';
  if (!('number' in properties)) return '';
  const numberProp = properties.number;
  if (typeof numberProp !== 'object' || numberProp === null) return '';
  if (!('description' in numberProp)) return '';
  const description = numberProp.description;
  return typeof description === 'string' ? description : '';
}

describe('issue #3019 (AB2): github tool documents per-operation params', () => {
  /**
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB2
   * @issue 3019
   */
  it('description states pr.resolve-thread is addressed by threadId, not number', () => {
    const tool = new GithubTool(stubClient());
    expect(tool.description).toContain('pr.resolve-thread');
    expect(tool.description).toContain('threadId');
  });

  /**
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB2
   * @issue 3019
   */
  it('description states operations reject parameters they do not accept', () => {
    const tool = new GithubTool(stubClient());
    expect(tool.description).toContain('reject');
  });

  /**
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB2
   * @issue 3019
   */
  it('number schema description notes it is per-operation and may be rejected', () => {
    const tool = new GithubTool(stubClient());
    const description = numberSchemaDescription(tool);
    expect(description.length).toBeGreaterThan(0);
    expect(description).toContain('rejects');
  });
});
