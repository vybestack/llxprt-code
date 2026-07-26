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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length !== 3) {
    process.stderr.write(
      'Usage: ocr-canary-compare-2673.cjs <canary2.json> <canary3.json> <canary4.json>\n',
    );
    process.exitCode = 2;
    return;
  }
  try {
    const { buildComparison, isComparisonResult } = await import(
      path.join(__dirname, 'lib', 'ocr-concurrency-canary-2673-comparator.js')
    );
    const artifacts = argv.map((filePath) => readArtifact(filePath));
    const result = buildComparison(artifacts);
    if (!isComparisonResult(result)) {
      throw new Error(
        'Comparator returned an invalid result: expected boolean valid and string-array errors',
      );
    }
    writeResult(result);
    process.exitCode = result.valid ? 0 : 1;
  } catch (error) {
    writeResult({ valid: false, errors: [errorMessage(error)] });
    process.exitCode = 1;
  }
}

void main();
