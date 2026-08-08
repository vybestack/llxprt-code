/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from 'node:process';

export interface RealProviderRunRecord {
  readonly testName: string;
  readonly testDir: string;
}

function hasNonEmptyStringField(value: object, field: string): boolean {
  if (!(field in value)) {
    return false;
  }
  const fieldValue: unknown = Reflect.get(value, field);
  return typeof fieldValue === 'string' && fieldValue.length > 0;
}

function isRealProviderRunRecord(
  value: unknown,
): value is RealProviderRunRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    hasNonEmptyStringField(value, 'testName') &&
    hasNonEmptyStringField(value, 'testDir')
  );
}

export function recordRealProviderRun(record: RealProviderRunRecord): void {
  const ledgerPath = env['LLXPRT_E2E_MODEL_LEDGER'];
  if (ledgerPath === undefined || ledgerPath.trim().length === 0) {
    return;
  }

  const parentDir = dirname(ledgerPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`, 'utf-8');
}

export function readLedger(
  ledgerPath: string,
): readonly RealProviderRunRecord[] {
  if (!existsSync(ledgerPath)) {
    throw new Error(`Ledger file does not exist: ${ledgerPath}`);
  }

  const content = readFileSync(ledgerPath, 'utf-8');
  const records: RealProviderRunRecord[] = [];

  for (const line of content.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Ledger line is not valid JSON: ${line}`);
    }

    if (!isRealProviderRunRecord(parsed)) {
      throw new Error(
        `Ledger line is missing required non-empty testName and testDir string fields: ${line}`,
      );
    }

    records.push(parsed);
  }

  return records;
}
