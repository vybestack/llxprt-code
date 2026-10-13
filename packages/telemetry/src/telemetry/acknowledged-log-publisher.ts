/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LogRecord } from '@opentelemetry/api-logs';
import type { LoggerProvider } from '@opentelemetry/sdk-logs';
import type { AcknowledgedLogExporter } from './artifact-exporter.js';
import { SERVICE_NAME } from './constants.js';

/**
 * Publishes log records whose completion requires export acknowledgement
 * (strict request-artifact logging). One publisher belongs to one SDK
 * lifetime of one RootTelemetry; it holds no module state.
 */
export class AcknowledgedLogPublisher {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly provider: LoggerProvider,
    private readonly exporter: AcknowledgedLogExporter,
    private readonly sessionId: string,
  ) {}

  supportsArtifacts(): boolean {
    return this.exporter.supportsRequestArtifacts();
  }

  assertSupport(): void {
    this.exporter.assertArtifactSupport();
  }

  publish(record: LogRecord, signal?: AbortSignal): Promise<void> {
    this.assertSupport();
    if (record.attributes?.schema_version !== 4)
      return this.deliver(record, signal, false);
    // Schema 4 chunks are flushed one at a time so the batch queue never
    // retains more than one transcript chunk.
    const next = this.tail
      .catch(() => undefined)
      .then(() => this.deliver(record, signal, true));
    this.tail = next;
    return next;
  }

  private async deliver(
    record: LogRecord,
    signal: AbortSignal | undefined,
    flush: boolean,
  ): Promise<void> {
    const receipt = this.exporter.receipt(
      {
        ...record,
        attributes: { 'session.id': this.sessionId, ...record.attributes },
      },
      signal,
    );
    try {
      this.provider.getLogger(SERVICE_NAME).emit(receipt.record);
    } catch (error: unknown) {
      receipt.fail(error);
    }
    if (flush)
      await Promise.all([
        this.provider.forceFlush().catch(() => undefined),
        receipt.acknowledged,
      ]);
    else await receipt.acknowledged;
    signal?.throwIfAborted();
  }
}
