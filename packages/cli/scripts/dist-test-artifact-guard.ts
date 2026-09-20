/**
 * @license
 * Copyright 2026 Vybestack
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Post-build guard for the dist tree (issue #2615 sweep).
 *
 * `tsc --build` honors tsconfig.build.json excludes, but any test-only module
 * that is still reachable through an import from a compiled root gets emitted
 * regardless of excludes, and scripts/copy_files.ts mirrors every non-`__tests__`
 * source directory into dist even when nothing copyable is inside. Both paths
 * leak test-only artifacts into the package output.
 *
 * Artifacts split into two classes. Compiled emissions of test-named modules
 * (.js/.js.map/.d.ts/.d.ts.map) mean production code imports test-only code:
 * they fail the build before any deletion rather than being silently
 * stripped. Mirrored/static non-emission artifacts are removed, and the build
 * still fails if any test artifact survived, so a new pattern cannot ship
 * silently.
 */
import fs from 'node:fs';
import path from 'node:path';

const distDir = path.join(process.cwd(), 'dist');

/** Directory basenames that only ever contain test-only content. */
const TEST_DIR_NAMES = new Set([
  '__tests__',
  '__testhelpers__',
  '__mocks__',
  '__snapshots__',
  'test',
  'tests',
  'test-utils',
  'test-support',
  'integration-tests',
]);

/** Basename segments (dot/dash/underscore delimited) that mark test files. */
const TEST_FILE_SEGMENTS =
  /(^|[._-])(test-utils|test-support|test-helpers?|testhelpers|testhelper|fixtures|test-setup|testsetup)([._-]|$)/i;

/** Emitted-suffix forms of test files (covers .js, .js.map, .d.ts variants). */
const TEST_FILE_SUFFIX = /\.(test|spec|bun|test-d)\./;

/** Compilation-output suffixes: a test-named dist file ending in one of
 * these was emitted by tsc, not merely mirrored by copy_files.ts. */
const COMPILED_OUTPUT_SUFFIXES = ['.js', '.js.map', '.d.ts', '.d.ts.map'];

function isTestFileName(name: string): boolean {
  return TEST_FILE_SUFFIX.test(name) || TEST_FILE_SEGMENTS.test(name);
}

function isTestArtifact(relPath: string): boolean {
  const segments = relPath.split(path.sep);
  return (
    segments.some((s) => TEST_DIR_NAMES.has(s)) ||
    isTestFileName(segments[segments.length - 1]!)
  );
}

function isCompiledTestOutput(name: string): boolean {
  return COMPILED_OUTPUT_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function walk(dir: string, acc: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    }
    acc.push(full);
  }
}

function main(): void {
  if (!fs.existsSync(distDir)) {
    console.log('dist-test-artifact-guard: no dist directory, nothing to do');
    return;
  }

  const all: string[] = [];
  walk(distDir, all);

  // Emitted test modules are a build defect, not clutter: a compiled
  // .js/.d.ts of a test-named module exists only because production code
  // imports test-only code. Fail before deleting anything so the offending
  // tree stays inspectable.
  const emitted = all.filter((full) => {
    const rel = path.relative(distDir, full);
    if (rel === '' || !isTestArtifact(rel)) {
      return false;
    }
    return (
      fs.statSync(full).isFile() && isCompiledTestOutput(path.basename(rel))
    );
  });
  if (emitted.length > 0) {
    console.error(
      'dist-test-artifact-guard: compiled test modules found in dist ' +
        '(production code imports test-only code; fix the import or the ' +
        'build config instead of stripping the artifact):',
    );
    for (const full of emitted) {
      console.error(`  ${path.relative(distDir, full)}`);
    }
    process.exit(1);
  }

  // Mirrored/static non-emission artifacts: keep the delete-then-verify
  // behavior.
  const toDelete = all.filter((full) => {
    const rel = path.relative(distDir, full);
    return rel !== '' && isTestArtifact(rel);
  });

  // Deepest paths first so directory removals happen after their contents.
  toDelete.sort((a, b) => b.length - a.length);
  for (const full of toDelete) {
    fs.rmSync(full, { recursive: true, force: true });
  }
  console.log(
    `dist-test-artifact-guard: removed ${toDelete.length} artifact(s)`,
  );

  // Verify: no test artifact may remain; fail the build otherwise.
  const survivors: string[] = [];
  walk(distDir, survivors);
  const remaining = survivors
    .map((full) => path.relative(distDir, full))
    .filter((rel) => rel !== '' && isTestArtifact(rel));
  if (remaining.length > 0) {
    console.error('dist-test-artifact-guard: test artifacts survived cleanup:');
    for (const rel of remaining) {
      console.error(`  ${rel}`);
    }
    process.exit(1);
  }
  console.log('dist-test-artifact-guard: dist is clean of test artifacts');
}

main();
