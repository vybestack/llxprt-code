/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { RootTelemetryTransports } from './root-telemetry.js';

export function trackTransportOutcomes(selected: RootTelemetryTransports): {
  readonly transports: RootTelemetryTransports;
  readonly takeFailures: () => Error[];
  readonly joinAccepted: () => Promise<void>;
} {
  const failures: Error[] = [];
  const pending = new Set<Promise<void>>();
  const track = <T>(
    data: T,
    send: (data: T, done: (result: ExportResult) => void) => void,
    done: (result: ExportResult) => void,
  ): void => {
    let finish: () => void = () => undefined;
    const accepted = new Promise<void>((resolveValue) => {
      finish = resolveValue;
    });
    pending.add(accepted);
    try {
      send(data, (result) => {
        if (result.code === ExportResultCode.FAILED)
          failures.push(result.error ?? new Error('Telemetry export failed'));
        pending.delete(accepted);
        finish();
        done(result);
      });
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
      pending.delete(accepted);
      finish();
      throw error;
    }
  };
  return {
    takeFailures: () => failures.splice(0),
    joinAccepted: async () => {
      await Promise.all([...pending]);
    },
    transports: {
      tracer: {
        export: (data, done) =>
          track(data, selected.tracer.export.bind(selected.tracer), done),
        shutdown: () => selected.tracer.shutdown(),
        forceFlush: selected.tracer.forceFlush?.bind(selected.tracer),
      },
      logger: {
        export: (data, done) =>
          track(data, selected.logger.export.bind(selected.logger), done),
        shutdown: () => selected.logger.shutdown(),
        forceFlush: () => selected.logger.forceFlush(),
      },
      meter: {
        export: (data, done) =>
          track(data, selected.meter.export.bind(selected.meter), done),
        shutdown: () => selected.meter.shutdown(),
        forceFlush: () => selected.meter.forceFlush(),
        get selectAggregationTemporality() {
          return selected.meter.selectAggregationTemporality?.bind(
            selected.meter,
          );
        },
        get selectAggregation() {
          return selected.meter.selectAggregation?.bind(selected.meter);
        },
      },
    },
  };
}
