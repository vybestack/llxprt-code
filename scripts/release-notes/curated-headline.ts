/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pattern for valid version strings used in curated headline filenames.
 * Allows digits, dots, hyphens (for pre-release), and alphanumerics only.
 */
const VERSION_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * Loads an optional curated headline from `docs/release-notes/<version>.md`.
 * This is the "maintainer headline channel" (issue E): for stable releases,
 * a maintainer may pre-author a headline that gets prepended to the generated
 * notes. Returns null when absent or empty — graceful degradation.
 *
 * The version is validated against a strict pattern to prevent path traversal.
 */
export function loadCuratedHeadline(
  docsDir: string,
  version: string,
): string | null {
  if (!VERSION_PATTERN.test(version)) {
    return null;
  }
  const filePath = join(docsDir, `${version}.md`);
  if (!existsSync(filePath)) {
    return null;
  }
  const content = readFileSync(filePath, 'utf-8');
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}
