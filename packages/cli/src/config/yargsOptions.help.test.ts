/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavior tests asserting that user-visible CLI help text no longer names
 * the legacy `~/.llxprt` home directory. Generated help/schema text must use
 * category-neutral phrasing (the LLxprt config/cache/data directories),
 * because the real locations are platform-specific and overridable via
 * LLXPRT_*_HOME env vars.
 *
 * These tests read the REAL exported options object — no mocks.
 */
import { describe, it, expect } from 'vitest';
import { rootOptions, innerCommandOptions } from './yargsOptions.js';

describe('yargs help text is category-neutral (no legacy ~/.llxprt)', () => {
  it('sandbox-profile-load description does not name ~/.llxprt', () => {
    const opt = innerCommandOptions['sandbox-profile-load'];
    expect(opt).toBeDefined();
    const description = opt.description ?? '';
    expect(description).not.toContain('~/.llxprt');
  });

  it('dumponerror description does not name ~/.llxprt', () => {
    const opt = innerCommandOptions['dumponerror'];
    expect(opt).toBeDefined();
    const description = opt.description ?? '';
    expect(description).not.toContain('~/.llxprt');
  });

  it('all root option descriptions are free of ~/.llxprt', () => {
    const descriptions = Object.values(rootOptions)
      .map((opt) => opt.description)
      .filter((desc): desc is string => typeof desc === 'string');
    expect(descriptions.every((desc) => !desc.includes('~/.llxprt'))).toBe(
      true,
    );
  });

  it('all inner command option descriptions are free of ~/.llxprt', () => {
    const descriptions = Object.values(innerCommandOptions)
      .map((opt) => opt.description)
      .filter((desc): desc is string => typeof desc === 'string');
    expect(descriptions.every((desc) => !desc.includes('~/.llxprt'))).toBe(
      true,
    );
  });
});
