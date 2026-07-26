#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cross-artifact comparison validator for OCR concurrency canary evidence
 * (issue #2673). Validates three canary metrics JSON artifacts against
 * strict provenance equality and decision-rule requirements.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readArtifact(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read artifact ${filePath}: ${error.message}`, {
      cause: error,
    });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length !== 3) {
    process.stderr.write(
      'Usage: ocr-canary-compare-2673.cjs <canary2.json> <canary3.json> <canary4.json>\n',
    );
    process.exit(2);
  }
  const { buildComparison } = await import(
    path.join(
      __dirname,
      '..',
      'scripts',
      'tests',
      'ocr-concurrency-canary-2673-comparator.js',
    )
  );
  const artifacts = argv.map((filePath) => readArtifact(filePath));
  const result = buildComparison(artifacts);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.valid ? 0 : 1);
}

main();
