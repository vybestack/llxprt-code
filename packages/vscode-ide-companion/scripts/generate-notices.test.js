/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { normalizeGitHubRepositoryUrl } from './generate-notices.js';

describe('normalizeGitHubRepositoryUrl', () => {
  it('canonicalizes the deprecated git:// GitHub protocol to https://', () => {
    expect(
      normalizeGitHubRepositoryUrl(
        'git://github.com/beaugunderson/ip-address.git',
      ),
    ).toBe('https://github.com/beaugunderson/ip-address.git');
  });

  it('is idempotent for URLs already on the canonical protocol', () => {
    const canonical = 'https://github.com/isaacs/node-which.git';
    expect(normalizeGitHubRepositoryUrl(canonical)).toBe(canonical);
  });

  it('leaves non-GitHub git:// URLs untouched', () => {
    const other = 'git://example.com/vendor/repo.git';
    expect(normalizeGitHubRepositoryUrl(other)).toBe(other);
  });

  it('leaves the absent-repository sentinel untouched', () => {
    expect(normalizeGitHubRepositoryUrl('No repository found')).toBe(
      'No repository found',
    );
  });

  it('passes non-string values through unchanged instead of throwing', () => {
    expect(normalizeGitHubRepositoryUrl(undefined)).toBeUndefined();
    expect(normalizeGitHubRepositoryUrl(null)).toBeNull();
  });
});
