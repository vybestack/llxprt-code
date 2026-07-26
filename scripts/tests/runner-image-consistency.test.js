/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for runner image consistency across workflows (issue #2688).
 *
 * Background: release.yml was pinned to ubuntu-22.04 for a sharp/libspng
 * incompatibility. sharp was later dropped from the dependency tree, but the
 * pin stayed. That left exactly one workflow on a runner image no other
 * workflow used -- and because release is not a PR check, ubuntu-22.04 had
 * zero pre-merge coverage. The assign harness broke there and the failure was
 * only discovered by the nightly, hours after the causing commit merged.
 *
 * A runner image used by exactly one non-PR workflow is an untested platform
 * by construction. These tests pin the invariant that workflows share runner
 * images, so a reintroduced pin has to be deliberate rather than accidental.
 */

import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const WORKFLOW_DIR = path.join(ROOT, '.github/workflows');

/**
 * Collect every literal runner image referenced anywhere in the workflow
 * directory. Walks the parsed YAML rather than grepping so that matrix
 * entries, reusable-workflow jobs and plain `runs-on` are all covered, and so
 * that a value inside a comment cannot produce a false positive.
 *
 * @returns {Map<string, string[]>} image -> workflow files referencing it
 */
function collectRunnerImages() {
  const images = new Map();

  const record = (image, file) => {
    // Expression-valued runs-on (matrix indirection) is resolved by walking
    // the matrix values themselves, so skip the unresolved expression.
    if (typeof image !== 'string' || image.includes('${{')) {
      return;
    }
    if (!/^(ubuntu|macos|windows)-/.test(image)) {
      return;
    }
    const existing = images.get(image) ?? [];
    if (!existing.includes(file)) {
      existing.push(file);
    }
    images.set(image, existing);
  };

  // A runner reference is either a bare string or a list of them; normalizing
  // here keeps the traversal below flat.
  const recordAll = (value, file) => {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      record(entry, file);
    }
  };

  // `runs-on` names an image directly; a matrix `os` list feeds `runs-on`
  // through expression indirection. Both are sources of runner images.
  const isRunnerKey = (key) => key === 'runs-on' || key === 'os';

  const walk = (node, file) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, file);
      }
      return;
    }
    if (node === null || typeof node !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (isRunnerKey(key)) {
        recordAll(value, file);
      }
      walk(value, file);
    }
  };

  for (const file of fs.readdirSync(WORKFLOW_DIR)) {
    if (!/\.ya?ml$/.test(file)) {
      continue;
    }
    const parsed = yaml.load(
      fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8'),
    );
    if (parsed && typeof parsed === 'object') {
      walk(parsed, file);
    }
  }

  return images;
}

describe('runner image consistency (#2688)', () => {
  it('pins no workflow to a specific Ubuntu point release', () => {
    // A pinned point release (ubuntu-22.04) drifts away from ubuntu-latest
    // over time. Whichever workflow holds the pin ends up on a platform the
    // rest of CI never exercises.
    const images = collectRunnerImages();
    const pinned = [...images.entries()]
      .filter(([image]) => /^ubuntu-\d+\.\d+$/.test(image))
      .map(([image, files]) => `${image} (${files.join(', ')})`);

    expect(pinned).toStrictEqual([]);
  });

  it('runs the release workflow on the same Ubuntu image as CI', () => {
    // Release runs the full preflight suite. If it runs on a different image
    // than the PR gate, the release is the first place an image-specific
    // break can surface -- which is the worst possible place to find one.
    const release = yaml.load(
      fs.readFileSync(path.join(WORKFLOW_DIR, 'release.yml'), 'utf8'),
    );
    const ci = yaml.load(
      fs.readFileSync(path.join(WORKFLOW_DIR, 'ci.yml'), 'utf8'),
    );

    const releaseRunner = release.jobs?.release?.['runs-on'];
    // The sharded test job is `test_shard` (issue #2707); the virtual `test`
    // aggregator has no matrix. Fall back to `test` for compatibility with
    // workflows that have not yet adopted sharding.
    const testJob =
      ci.jobs?.test_shard?.strategy?.matrix?.os ??
      ci.jobs?.test?.strategy?.matrix?.os ??
      [];

    expect(releaseRunner).toBe('ubuntu-latest');
    expect(testJob).toContain(releaseRunner);
  });

  it('exercises every referenced runner image in more than one workflow', () => {
    // The concrete failure mode from #2688: an image referenced by exactly
    // one workflow is, by definition, only as tested as that workflow. When
    // that workflow is not a PR check, the platform has no pre-merge gate.
    const images = collectRunnerImages();
    const orphans = [...images.entries()]
      .filter(([, files]) => files.length === 1)
      .map(([image, files]) => `${image} used only by ${files[0]}`);

    expect(orphans).toStrictEqual([]);
  });
});
