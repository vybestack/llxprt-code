/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LogRecord } from '@opentelemetry/api-logs';

const MAX_TERMINAL_RECORDS = 2;

/**
 * Telemetry captured while a terminal publication is built: log records are
 * published with acknowledgement first, and the metric and aggregation effects
 * run only after the caller accepts the acknowledged publication.
 */
export class TerminalPublication {
  readonly records: LogRecord[] = [];
  readonly effects: Array<() => void> = [];

  addRecord(record: LogRecord): void {
    if (this.records.length === MAX_TERMINAL_RECORDS)
      throw new Error('Terminal telemetry exceeds two records');
    this.records.push(record);
  }
}
