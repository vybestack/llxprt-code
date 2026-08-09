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
 * by construction unless that platform is intentionally reserved for
 * mandatory nightly validation. These tests pin the invariant that workflows
 * share runner images except for the macOS nightly-only cadence established by
 * issue #3189, so a reintroduced pin or any other singleton has to be deliberate
 * rather than accidental.
 */

import { describe, expect, it } from 'bun:test';
import yaml from 'js-yaml';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { asRecord, asRecordMap } from './typed-test-helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const WORKFLOW_DIR = path.join(ROOT, '.github/workflows');
const SHARD_SELECTOR = path.join(ROOT, 'scripts/affected-test-shards.ts');

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

  const record = (image: string | string[], file: string) => {
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

  // A runner reference is either a bare string, a list of strings, or a
  // dynamic-matrix expression whose concrete rows are produced by the shard
  // selector. The selector's output function owns those literal runner images.
  const recordAll = (value: unknown, file: string) => {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      record(entry, file);
    }
  };

  const recordShardSelectorImages = (file: string): void => {
    const selector = fs.readFileSync(SHARD_SELECTOR, 'utf8');
    // The selector emits runner images via its matrix builder (issue #2876
    // changed from a for-of OS loop to direct ubuntu-only entries). Scan for
    // all literal runner-image strings so every image the selector can
    // produce is recorded.
    const runnerImageRe = /'((?:ubuntu|macos|windows)-latest)'/g;
    let found = false;
    for (const match of selector.matchAll(runnerImageRe)) {
      record(match[1], file);
      found = true;
    }
    if (!found) {
      throw new Error(
        'affected-test-shards.ts must define at least one runner OS image',
      );
    }
  };

  // `runs-on` names an image directly; a matrix `os` list feeds `runs-on`
  // through expression indirection. Dynamic shard rows are emitted by the
  // selector and consumed through matrix.include.
  const isRunnerKey = (key: string) => key === 'runs-on' || key === 'os';

  const walk = (node: unknown, file: string) => {
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
      if (
        key === 'include' &&
        typeof value === 'string' &&
        value.includes('needs.shard_selector.outputs.matrix')
      ) {
        recordShardSelectorImages(file);
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
    const releaseParsed = asRecord(
      yaml.load(
        fs.readFileSync(path.join(WORKFLOW_DIR, 'release.yml'), 'utf8'),
      ),
    );
    const releaseJobs = asRecordMap(releaseParsed['jobs'] ?? {});
    const releaseRunner = releaseJobs['release']?.['runs-on'];
    const ciRunners = collectRunnerImages();

    expect(releaseRunner).toBe('ubuntu-latest');
    expect(ciRunners.get(releaseRunner ?? '')).toContain('ci.yml');
  });

  it('keeps macOS nightly-only and exercises every other image in multiple workflows', () => {
    // The concrete failure mode from #2688: an image referenced by exactly
    // one workflow is, by definition, only as tested as that workflow. When
    // that workflow is not a PR check, the platform has no pre-merge gate.
    // Issue #3189 deliberately makes macOS the sole exception while preserving
    // its mandatory nightly coverage.
    const images = collectRunnerImages();
    const orphans = [...images.entries()]
      .filter(([, files]) => files.length === 1)
      .map(([image, files]) => `${image} used only by ${files[0]}`);

    expect(orphans).toStrictEqual(['macos-latest used only by nightly.yml']);
  });
});
