/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { trackTransportOutcomes } from './transport-outcomes.js';
import {
  ROOT_CONTEXT,
  type Attributes,
  type Meter,
  type AttributeValue,
  type SpanOptions,
  ValueType,
} from '@opentelemetry/api';
import type { LogRecord } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  type SpanExporter,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-node';
import {
  LoggerProvider,
  type LogRecordExporter,
  ConsoleLogRecordExporter,
} from '@opentelemetry/sdk-logs';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
  ConsoleMetricExporter,
} from '@opentelemetry/sdk-metrics';
import {
  FileLogExporter,
  FileMetricExporter,
  FileSpanExporter,
} from './file-exporters.js';
import { AcknowledgedLogExporter } from './artifact-exporter.js';
import { AcknowledgedLogPublisher } from './acknowledged-log-publisher.js';
import { CorrelatedLogRecordProcessor } from './correlated-log-processor.js';
import { TerminalPublication } from './terminal-publication.js';
import {
  METRIC_FILE_OPERATION_COUNT,
  METRIC_API_REQUEST_COUNT,
  METRIC_API_REQUEST_LATENCY,
  METRIC_TOKEN_USAGE,
  METRIC_SESSION_COUNT,
  METRIC_TOOL_CALL_COUNT,
  METRIC_TOOL_CALL_LATENCY,
  SERVICE_NAME,
} from './constants.js';

interface TelemetryPrivacySettings {
  readonly logPrompts: boolean;
  readonly logConversations: boolean;
  readonly logApiBodies: boolean;
  readonly maxChars: number;
}

export interface RootTelemetryOptions {
  readonly readPrivacySettings?: () => TelemetryPrivacySettings;
  readonly enabled: boolean;
  readonly sessionId: string;
  readonly outfile?: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
}

export interface TelemetryEventOperations {
  record(collect: () => LogRecord): void;
}

export interface TelemetrySpan {
  setAttribute(name: string, value: AttributeValue): void;
  end(): void;
}

export interface TelemetrySpanOperations {
  start(name: string, options?: SpanOptions): TelemetrySpan;
}

export interface TelemetryMeasurementOperations {
  fileOperation(attributes: Attributes): void;
  tokenUsage(
    model: string,
    count: number,
    type: string,
    attributes?: Attributes,
  ): void;
  modelResponse(
    model: string,
    durationMs: number,
    statusCode: number | string,
    attributes?: Attributes,
  ): void;
  toolCall(
    functionName: string,
    durationMs: number,
    success: boolean,
    attributes?: Attributes,
  ): void;
}

export interface RootTelemetryTransports {
  readonly tracer: SpanExporter;
  readonly logger: LogRecordExporter;
  readonly meter: PushMetricExporter;
}

interface Providers {
  readonly tracer: NodeTracerProvider;
  readonly logger: LoggerProvider;
  readonly meter: MeterProvider;
  readonly publisher: AcknowledgedLogPublisher;
  readonly takeFailures: () => Error[];
  readonly joinAccepted: () => Promise<void>;
}

interface ProviderLifetime {
  readonly providers: Providers;
  readonly finishSpans: () => void;
  readonly events: TelemetryEventOperations;
  readonly spans: TelemetrySpanOperations;
  readonly measurements: TelemetryMeasurementOperations;
}

async function createProviders(
  options: RootTelemetryOptions,
  selected: RootTelemetryTransports,
): Promise<Providers> {
  // The acknowledging exporter wraps the selected transport itself so its
  // schema support is visible, and failures are tracked outside it.
  const artifactExporter = new AcknowledgedLogExporter(selected.logger);
  const { transports, takeFailures, joinAccepted } = trackTransportOutcomes({
    ...selected,
    logger: artifactExporter,
  });
  const resource = resourceFromAttributes({
    'service.name': SERVICE_NAME,
    'service.version': process.version,
    'session.id': options.sessionId,
  });
  const release = new Map<string, () => Promise<void>>([
    ['tracer', () => transports.tracer.shutdown()],
    ['logger', () => transports.logger.shutdown()],
    ['meter', () => transports.meter.shutdown()],
  ]);
  try {
    const tracer = new NodeTracerProvider({
      resource,
      spanProcessors: [new SimpleSpanProcessor(transports.tracer)],
    });
    release.set('tracer', () => tracer.shutdown());
    const logger = new LoggerProvider({
      resource,
      processors: [new CorrelatedLogRecordProcessor(transports.logger)],
    });
    release.set('logger', () => logger.shutdown());
    const meter = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: transports.meter,
          exportIntervalMillis: 10000,
          exportTimeoutMillis: 5000,
        }),
      ],
    });
    const publisher = new AcknowledgedLogPublisher(
      logger,
      artifactExporter,
      options.sessionId,
    );
    return { tracer, logger, meter, publisher, takeFailures, joinAccepted };
  } catch (primary) {
    const releases = await Promise.allSettled(
      [...release.values()].map((close) => Promise.resolve().then(close)),
    );
    const failures = releases.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(
        [primary, ...failures],
        'Telemetry startup and cleanup failed',
      );
    throw primary;
  }
}

async function flushProviders(providers: Providers): Promise<void> {
  const results = await Promise.allSettled(
    [
      async () => providers.tracer.forceFlush(),
      async () => providers.logger.forceFlush(),
      async () => providers.meter.forceFlush(),
    ].map((flush) => Promise.resolve().then(flush)),
  );
  await providers.joinAccepted();
  const failures = [
    ...results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    ),
    ...providers.takeFailures(),
  ];
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Telemetry flush failed');
}

function bindSpans(
  provider: NodeTracerProvider,
  sessionId: string,
  permitted: () => boolean,
): {
  readonly spans: TelemetrySpanOperations;
  readonly finishSpans: () => void;
} {
  const tracer = provider.getTracer(SERVICE_NAME);
  const active = new Set<() => void>();
  return {
    finishSpans: () => {
      for (const finish of active) finish();
    },
    spans: {
      start: (name, options) => {
        if (!permitted())
          return { setAttribute: () => undefined, end: () => undefined };
        const span = tracer.startSpan(
          name,
          {
            ...options,
            attributes: { 'session.id': sessionId, ...options?.attributes },
          },
          ROOT_CONTEXT,
        );
        let ended = false;
        const finish = (): void => {
          if (ended) return;
          ended = true;
          active.delete(finish);
          span.end();
        };
        active.add(finish);
        return {
          setAttribute: (key, value) => {
            if (permitted() && !ended) span.setAttribute(key, value);
          },
          end: finish,
        };
      },
    },
  };
}

function bindOperations(
  providers: Providers,
  sessionId: string,
  permitted: () => boolean,
): ProviderLifetime {
  const logger = providers.logger.getLogger(SERVICE_NAME);
  return {
    providers,
    ...bindSpans(providers.tracer, sessionId, permitted),
    events: {
      record: (collect) => {
        if (!permitted()) return;
        const record = collect();
        logger.emit({
          ...record,
          attributes: { 'session.id': sessionId, ...record.attributes },
        });
      },
    },
    measurements: bindMeasurements(
      providers.meter.getMeter(SERVICE_NAME),
      sessionId,
      permitted,
    ),
  };
}

function bindMeasurements(
  meter: Meter,
  sessionId: string,
  permitted: () => boolean,
): TelemetryMeasurementOperations {
  const fileCount = meter.createCounter(METRIC_FILE_OPERATION_COUNT, {
    valueType: ValueType.INT,
  });
  const requestCount = meter.createCounter(METRIC_API_REQUEST_COUNT, {
    valueType: ValueType.INT,
  });
  const tokenCount = meter.createCounter(METRIC_TOKEN_USAGE, {
    valueType: ValueType.INT,
  });
  const sessionCount = meter.createCounter(METRIC_SESSION_COUNT, {
    valueType: ValueType.INT,
  });
  sessionCount.add(1, { 'session.id': sessionId });
  const requestLatency = meter.createHistogram(METRIC_API_REQUEST_LATENCY, {
    unit: 'ms',
  });
  const toolCount = meter.createCounter(METRIC_TOOL_CALL_COUNT);
  const toolLatency = meter.createHistogram(METRIC_TOOL_CALL_LATENCY, {
    unit: 'ms',
  });
  return {
    fileOperation: (attributes) => {
      if (permitted())
        fileCount.add(1, { 'session.id': sessionId, ...attributes });
    },
    tokenUsage: (model, count, type, attributes) => {
      if (permitted())
        tokenCount.add(count, {
          'session.id': sessionId,
          ...attributes,
          model,
          type,
        });
    },
    modelResponse: (model, durationMs, statusCode, extraAttributes) => {
      if (!permitted()) return;
      const attributes: Attributes = {
        'session.id': sessionId,
        ...extraAttributes,
        model,
        status_code: statusCode,
      };
      requestCount.add(1, attributes);
      requestLatency.record(durationMs, {
        'session.id': sessionId,
        ...extraAttributes,
        model,
      });
    },
    toolCall: (functionName, durationMs, success, extraAttributes) => {
      if (!permitted()) return;
      const attributes: Attributes = {
        'session.id': sessionId,
        ...extraAttributes,
        function_name: functionName,
        success,
      };
      toolCount.add(1, attributes);
      toolLatency.record(durationMs, {
        'session.id': sessionId,
        ...extraAttributes,
        function_name: functionName,
      });
    },
  };
}

export class RootTelemetry {
  private accepting = false;
  private closed = false;
  private lifetime: ProviderLifetime | undefined;
  private pendingFlush: Promise<void> | undefined;
  private pendingRetirement: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private requestedEnabled = false;
  private revision = 0;
  private transition: Promise<void> = Promise.resolve();
  private readAdmission = (): boolean => this.accepting;

  private terminal: TerminalPublication | undefined;

  readonly events: TelemetryEventOperations = {
    record: (collect) => {
      if (!this.accepting) return;
      if (this.terminal !== undefined) this.terminal.addRecord(collect());
      else this.requireLifetime().events.record(collect);
    },
  };
  readonly spans: TelemetrySpanOperations = {
    start: (name, options) =>
      this.accepting
        ? this.requireLifetime().spans.start(name, options)
        : { setAttribute: () => undefined, end: () => undefined },
  };
  readonly measurements: TelemetryMeasurementOperations = {
    fileOperation: (attributes) =>
      this.measure((m) => m.fileOperation(attributes)),
    tokenUsage: (model, count, type, attributes) =>
      this.measure((m) => m.tokenUsage(model, count, type, attributes)),
    modelResponse: (model, durationMs, statusCode, extraAttributes) =>
      this.measure((m) =>
        m.modelResponse(model, durationMs, statusCode, extraAttributes),
      ),
    toolCall: (functionName, durationMs, success, extraAttributes) =>
      this.measure((m) =>
        m.toolCall(functionName, durationMs, success, extraAttributes),
      ),
  };

  private constructor(
    private options: RootTelemetryOptions,
    private readonly transports: () => RootTelemetryTransports,
  ) {}

  static prepare(
    options: RootTelemetryOptions,
    transports?: () => RootTelemetryTransports,
  ): RootTelemetry {
    const captured = Object.freeze({ ...options });
    const runtime = new RootTelemetry(
      captured,
      transports ??
        (() =>
          captured.outfile === undefined
            ? {
                tracer: new ConsoleSpanExporter(),
                logger: new ConsoleLogRecordExporter(),
                meter: new ConsoleMetricExporter(),
              }
            : {
                tracer: new FileSpanExporter(captured.outfile, captured),
                logger: new FileLogExporter(captured.outfile, captured),
                meter: new FileMetricExporter(captured.outfile, captured),
              }),
    );
    return runtime;
  }

  static async create(
    options: RootTelemetryOptions,
    transports?: () => RootTelemetryTransports,
  ): Promise<RootTelemetry> {
    const root = RootTelemetry.prepare(options, transports);
    await root.setEnabled(options.enabled);
    return root;
  }

  readPrivacySettings(): TelemetryPrivacySettings {
    return (
      this.options.readPrivacySettings?.() ?? {
        logPrompts: false,
        logConversations: false,
        logApiBodies: false,
        maxChars: 4000,
      }
    );
  }

  isEnabled(): boolean {
    return this.accepting;
  }

  async prepareNewSession(sessionId: string): Promise<{
    publish: () => void;
    retire: () => Promise<void>;
    discard: () => Promise<void>;
  }> {
    if (this.closed) throw new Error('Telemetry root is closed');
    await this.transition;
    const options = Object.freeze({ ...this.options, sessionId });
    const candidate = RootTelemetry.prepare(options, this.transports);
    candidate.readAdmission = () => this.accepting;
    const enabled = this.requestedEnabled;
    try {
      await candidate.setEnabled(enabled);
    } catch (error) {
      try {
        await candidate.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Telemetry candidate preparation and cleanup failed',
        );
      }
      throw error;
    }
    return {
      retire: () => this.setEnabled(false),
      publish: () => {
        this.options = options;
        this.lifetime = candidate.lifetime;
        candidate.lifetime = undefined;
        candidate.accepting = false;
        this.requestedEnabled = enabled;
        this.accepting = enabled;
      },
      discard: () => candidate.close(),
    };
  }

  private measure(
    record: (measurements: TelemetryMeasurementOperations) => void,
  ): void {
    if (!this.accepting) return;
    const { measurements } = this.requireLifetime();
    if (this.terminal !== undefined)
      this.terminal.effects.push(() => record(measurements));
    else record(measurements);
  }

  /**
   * Runs a local side effect now, or after acknowledgement while a terminal
   * publication is being built by {@link acknowledgeTerminal}.
   */
  runAfterTerminalAcknowledgement(effect: () => void): void {
    if (this.terminal !== undefined) this.terminal.effects.push(effect);
    else effect();
  }

  /**
   * Whether this root is exporting through a log exporter that can carry
   * request artifact schema 4 (the console exporter cannot). Callers that
   * would otherwise ask for body artifacts check this first.
   */
  supportsRequestArtifacts(): boolean {
    return (
      this.accepting &&
      this.requireLifetime().providers.publisher.supportsArtifacts()
    );
  }

  /** Throws unless this root is exporting and its log exporter supports request artifact schema 4. */
  assertRequestArtifactExporter(): void {
    if (!this.accepting)
      throw new Error(
        'Request artifact logging requires an active telemetry SDK',
      );
    this.requireLifetime().providers.publisher.assertSupport();
  }

  /** Resolves once the exporter has acknowledged the record; rejects on export failure, abort or missing ACK. */
  async publishAcknowledged(
    record: LogRecord,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertRequestArtifactExporter();
    await this.requireLifetime().providers.publisher.publish(record, signal);
  }

  /**
   * Captures the (at most two) log records that `build` emits, publishes them
   * with acknowledgement, and returns the deferred metric and aggregation
   * effects for the caller to run once it accepts the publication.
   */
  async acknowledgeTerminal(
    build: () => void,
    signal?: AbortSignal,
  ): Promise<() => void> {
    this.assertRequestArtifactExporter();
    const publication = new TerminalPublication();
    const previous = this.terminal;
    this.terminal = publication;
    try {
      build();
    } finally {
      this.terminal = previous;
    }
    for (const record of publication.records)
      await this.publishAcknowledged(record, signal);
    publication.records.length = 0;
    return (): void => {
      for (const effect of publication.effects.splice(0)) effect();
    };
  }

  private requireLifetime(): ProviderLifetime {
    if (this.lifetime === undefined)
      throw new Error('Accepting telemetry has no SDK lifetime');
    return this.lifetime;
  }

  /**
   * Flushes queued log records without joining other in-flight exports, so a
   * best-effort publication never waits behind a withheld strict
   * acknowledgement. Export failures stay queued for the next {@link flush}.
   */
  flushLogRecords(): Promise<void> {
    if (this.lifetime === undefined)
      return this.pendingRetirement ?? Promise.resolve();
    return this.lifetime.providers.logger.forceFlush();
  }

  flush(): Promise<void> {
    if (this.pendingFlush !== undefined) return this.pendingFlush;
    if (this.lifetime === undefined)
      return this.pendingRetirement ?? Promise.resolve();
    const flushing = flushProviders(this.lifetime.providers);
    this.pendingFlush = flushing.finally(() => {
      this.pendingFlush = undefined;
    });
    return this.pendingFlush;
  }

  setEnabled(enabled: boolean): Promise<void> {
    if (this.closed) throw new Error('Telemetry root is closed');
    this.requestedEnabled = enabled;
    const revision = ++this.revision;
    if (!enabled) this.accepting = false;
    this.transition = this.transition
      .catch(() => undefined)
      .then(async () => {
        if (!enabled) {
          await this.retire();
          return;
        }
        if (!this.canActivate(revision)) return;
        if (this.lifetime === undefined) {
          const providers = await createProviders(
            this.options,
            this.transports(),
          );
          try {
            this.lifetime = bindOperations(
              providers,
              this.options.sessionId,
              this.readAdmission,
            );
          } catch (primary) {
            const releases = await Promise.allSettled([
              Promise.resolve().then(() => providers.tracer.shutdown()),
              Promise.resolve().then(() => providers.logger.shutdown()),
              Promise.resolve().then(() => providers.meter.shutdown()),
            ]);
            const failures = releases.flatMap((result) =>
              result.status === 'rejected' ? [result.reason] : [],
            );
            if (failures.length > 0)
              throw new AggregateError(
                [primary, ...failures],
                'Telemetry binding and cleanup failed',
              );
            throw primary;
          }
        }
        if (!this.canActivate(revision)) {
          await this.retire();
          return;
        }
        this.accepting = true;
      });
    return this.transition;
  }

  private canActivate(revision: number): boolean {
    return !this.closed && this.requestedEnabled && revision === this.revision;
  }

  private retire(): Promise<void> {
    if (this.pendingRetirement !== undefined) return this.pendingRetirement;
    if (this.lifetime === undefined) return Promise.resolve();
    const lifetime = this.lifetime;
    lifetime.finishSpans();
    const flushed = this.flush();
    this.lifetime = undefined;
    const retirement = (async (): Promise<void> => {
      const flushResult = await Promise.allSettled([flushed]);
      const { tracer, logger, meter } = lifetime.providers;
      const shutdownResult = await Promise.allSettled([
        Promise.resolve().then(() => tracer.shutdown()),
        Promise.resolve().then(() => logger.shutdown()),
        Promise.resolve().then(() => meter.shutdown()),
      ]);
      const failures = [...flushResult, ...shutdownResult].flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1)
        throw new AggregateError(failures, 'Telemetry shutdown failed');
    })();
    this.pendingRetirement = retirement.finally(() => {
      this.pendingRetirement = undefined;
    });
    return this.pendingRetirement;
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    this.accepting = false;
    this.requestedEnabled = false;
    this.closing = (async () => {
      const transitions = await Promise.allSettled([this.transition]);
      const retirement = await Promise.allSettled([
        Promise.resolve().then(() => this.retire()),
      ]);
      const failures = [...transitions, ...retirement].flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1)
        throw new AggregateError(
          failures,
          'Telemetry transition and close failed',
        );
    })();
    return this.closing;
  }
}

export function createRootTelemetry(
  options: RootTelemetryOptions,
  transports?: () => RootTelemetryTransports,
): Promise<RootTelemetry> {
  return RootTelemetry.create(options, transports);
}
