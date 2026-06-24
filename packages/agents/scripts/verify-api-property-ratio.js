#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// @plan:PLAN-20260617-COREAPI.P08  @requirement:REQ-019

/**
 * Property-based-test ratio checker for the Agent public API.
 *
 * Scans packages/agents/src/api/ spec and test files for test files
 * tagged with the plan marker @plan:PLAN-20260617-COREAPI (the DENOMINATOR)
 * and counts how many of those files use property-based testing via
 * fc.assert, test.prop, or it.prop (the NUMERATOR).
 *
 * Exit codes:
 *   0 — ratio >= 0.30, or no plan-tagged files yet (early-phase guard)
 *   1 — ratio < 0.30
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PLAN_MARKER = '@plan:PLAN-20260617-COREAPI';
const PROPERTY_PATTERN = /\bfc\.assert\b|\btest\.prop\b|\bit\.prop\b/;
const THRESHOLD = 0.3;
const TEST_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/**
 * Recursively collects all files under `dir` whose extension looks like a
 * test/spec file (.ts/.tsx/.js/.jsx). No glob dependencies required.
 */
function collectTestFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') {
        continue;
      }
      results.push(...collectTestFiles(fullPath));
    } else if (stat.isFile() && TEST_EXTENSIONS.has(extname(fullPath))) {
      if (entry.includes('.spec.') || entry.includes('.test.')) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

const apiDir = join(__dirname, '..', 'src', 'api');
const testFiles = collectTestFiles(apiDir);

let denominator = 0;
let numerator = 0;

for (const filePath of testFiles) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    continue;
  }
  if (!content.includes(PLAN_MARKER)) {
    continue;
  }
  denominator += 1;
  if (PROPERTY_PATTERN.test(content)) {
    numerator += 1;
  }
}

if (denominator === 0) {
  console.log(
    'property-ratio: no plan-tagged test cases yet (denominator 0) — skipping gate',
  );
  process.exit(0);
}

const ratio = numerator / denominator;
console.log(
  `property-ratio: numerator=${numerator} denominator=${denominator} ratio=${ratio.toFixed(4)} (threshold=${THRESHOLD})`,
);

if (ratio < THRESHOLD) {
  console.error(
    `FAIL: property-test ratio ${ratio.toFixed(2)} is below required ${THRESHOLD}`,
  );
  process.exit(1);
}

console.log('property-ratio: PASS');
process.exit(0);
