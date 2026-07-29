#!/usr/bin/env bun

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diffFromGit, parseArgs } from './eslint-guard/git.ts';
import { checkDiff } from './eslint-guard/check-diff.ts';
import {
  scanCliProductionTypeEscapes,
  checkCliSourcePolicy,
} from './eslint-guard/cli-scanner.ts';
import {
  scanModuleDirectives,
  scanCoreDirectives,
  scanRootTypeScriptSuppressions,
} from './eslint-guard/scanners.ts';
import { scanRepositoryLintEscapeHatches } from './eslint-guard/config-scanner.ts';
import {
  checkModuleCentralBypassesInConfig,
  checkCoreCentralBypassesInConfig,
  checkModuleDirectiveScopesInConfig,
  checkCoreDirectiveScopesInConfig,
} from './eslint-guard/bypass-detector.ts';
import { formatViolations } from './eslint-guard/violations.ts';

export { checkDiff } from './eslint-guard/check-diff.ts';
export { extractRuleKey } from './eslint-guard/rule-config.ts';
export {
  hasInlineEslintDirective,
  hasTypeScriptSuppression,
} from './eslint-guard/directive-scanner.ts';
export {
  scanCliProductionTypeEscapes,
  checkCliSourcePolicy,
} from './eslint-guard/cli-scanner.ts';
export {
  scanModuleDirectives,
  scanCoreDirectives,
  scanPackageDirectives,
  scanPackageTypeScriptSuppressions,
  scanRootTypeScriptSuppressions,
} from './eslint-guard/scanners.ts';
export {
  scanRepositoryLintEscapeHatches,
  extractScopeArray,
} from './eslint-guard/config-scanner.ts';
export {
  checkModuleCentralBypassesInConfig,
  checkCoreCentralBypassesInConfig,
  checkModuleDirectiveScopesInConfig,
  checkCoreDirectiveScopesInConfig,
} from './eslint-guard/bypass-detector.ts';
export { formatViolations } from './eslint-guard/violations.ts';

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const diff = diffFromGit(args.base, args.head);
  const violations = checkDiff(diff);

  // Issue #2114 durable guard: packages/cli/src must contain zero inline ESLint
  // disable/enable directives and must not be present in central directive
  // cleanup scope lists.
  violations.push(...checkCliSourcePolicy());
  violations.push(...scanCliProductionTypeEscapes());

  // Issue #2115 durable guard: packages/core must contain zero inline ESLint
  // disable/enable directives and must not be present in central directive
  // cleanup scope lists.
  violations.push(...scanCoreDirectives());

  // Issue #2122 durable guard: packages/policy must contain zero inline ESLint
  // disable/enable directives and must not be present in central directive
  // cleanup scope lists.
  violations.push(...scanModuleDirectives('packages/policy', '2122'));

  // Issue #2189 durable guard: all checked source in the repository must
  // contain zero TypeScript suppression directives
  // (@ts-ignore/@ts-expect-error/@ts-nocheck). The root scan mirrors the
  // diff-based checkDiff coverage universe (the whole repo, excluding
  // generated directories), so the durable guard is as strong as the
  // diff-based acceptance criteria. This supersedes the earlier per-package
  // scanPackageTypeScriptSuppressions loop, which only covered selected
  // packages src directories and left root-level scripts and config files
  // unguarded (#2189 review finding).
  violations.push(...scanRootTypeScriptSuppressions(process.cwd(), '2189'));

  // Issue #2227 durable guard: all repository TypeScript under packages and
  // integration-tests must be free of lint/type escape hatches, and central
  // lint policy must not preserve carve-outs for directives or explicit any.
  violations.push(...scanRepositoryLintEscapeHatches(process.cwd(), '2227'));
  const configPath = join(process.cwd(), 'eslint.config.js');
  if (existsSync(configPath)) {
    const configSource = readFileSync(configPath, 'utf8');
    violations.push(...checkCoreDirectiveScopesInConfig(configSource));
    violations.push(...checkCoreCentralBypassesInConfig(configSource));
    violations.push(
      ...checkModuleDirectiveScopesInConfig(
        configSource,
        'packages/policy',
        '2122',
        false,
      ),
    );
    violations.push(
      ...checkModuleCentralBypassesInConfig(
        configSource,
        'packages/policy',
        '2122',
      ),
    );
  }

  if (violations.length === 0) {
    console.log('ESLint policy guard passed.');
    return;
  }

  console.error('ESLint policy guard failed:');
  console.error(formatViolations(violations));
  process.exit(1);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
