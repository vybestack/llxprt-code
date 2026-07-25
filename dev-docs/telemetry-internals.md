# Telemetry Internals

Implementation details for LLxprt Code's OpenTelemetry instrumentation layer.
For the user-facing guide, see [docs/telemetry.md](../docs/telemetry.md).

## Initialization

The config constructor (`packages/core/src/config/configConstructor.ts`) calls
`initializeTelemetry(config)` whenever `config.telemetrySettings.enabled` is
`true`. The call is unconditional within that branch — no source modification is
required to enable telemetry.

`initializeTelemetry` lives in `packages/telemetry/src/telemetry/sdk.ts`. It
early-returns without starting the SDK when `getTelemetryEnabled()` returns
`false`.

## SDK configuration

When enabled, `initializeTelemetry` constructs a `NodeSDK`
(`@opentelemetry/sdk-node`) with:

- A resource identifying the service (`llxprt-code`), Node.js version, and
  session ID.
- Span, log, and metric processors/exporters.
- `HttpInstrumentation` for automatic HTTP span creation.

### Exporter selection

Exporters are selected based on whether a telemetry outfile is configured:

| Condition                 | Span exporter         | Log exporter               | Metric exporter         |
| ------------------------- | --------------------- | -------------------------- | ----------------------- |
| `telemetryOutfile` is set | `FileSpanExporter`    | `FileLogExporter`          | `FileMetricExporter`    |
| No outfile                | `ConsoleSpanExporter` | `ConsoleLogRecordExporter` | `ConsoleMetricExporter` |

The `File*Exporter` classes write to the configured outfile path. The
`Console*Exporter` classes write to stdout/stderr.

### No network exporters

OTLP exporters and any network-based exporters are **absent** from the code path.
There is no `OTLPExporter`, no gRPC/HTTP exporter, and no collector endpoint
configured. This is by design — telemetry data never leaves the local machine
through the SDK. The `otlpEndpoint` setting is read into the configuration but
never used to construct an exporter.

### No custom spans

The SDK registers **only** `HttpInstrumentation`. There are no `startSpan()`
calls in the telemetry code for tool calls, API requests, model responses, or
any other application-level events. All application-level telemetry is emitted
as **logs** (via `emitLogRecord`) and **metrics** (via OTEL metric instruments),
not as custom spans.

## Batch processors

- **Span processor**: `BatchSpanProcessor` with `scheduledDelayMillis: 100`,
  `maxExportBatchSize: 10`, `exportTimeoutMillis: 5000`.
- **Log processor**: `BatchLogRecordProcessor` with `scheduledDelayMillis: 0`
  (immediate), `maxExportBatchSize: 1`, `exportTimeoutMillis: 5000`.

## Shutdown

On `SIGTERM` or `SIGINT`, `shutdownTelemetry(config)` calls `sdk.shutdown()`.
The `flushTelemetry()` function force-flushes pending data.

## Local collector setup script (non-functional for data reception)

The `npm run telemetry -- --target=local` script
(`scripts/local_telemetry.js`) downloads and starts a local Jaeger instance and
an OpenTelemetry Collector (`otelcol-contrib`) for development use. However,
**the collector cannot receive any data from the SDK** because the SDK never
constructs an OTLP exporter — it only writes to `File*Exporter` or
`Console*Exporter`. The script (`manageTelemetrySettings` in
`scripts/telemetry_utils.js`) only writes settings (enabled, target,
otlpEndpoint) into the workspace `settings.json`; it does not inject an OTLP
exporter into the SDK at runtime.

As a result, running the collector script will start Jaeger and the collector,
but **no telemetry data will arrive at either**. The collector and Jaeger UI
will show zero traces/metrics/logs from LLxprt Code. This is a known limitation
of the current architecture.

## Key source files

- `packages/telemetry/src/telemetry/sdk.ts`: SDK initialization, exporter
  selection, shutdown.
- `packages/telemetry/src/telemetry/file-exporters.ts`: `FileSpanExporter`,
  `FileLogExporter`, `FileMetricExporter`.
- `packages/telemetry/src/telemetry/metrics.ts`: metric instrument initialization.
- `packages/telemetry/src/telemetry/loggers.ts`: log event emission.
- `packages/telemetry/src/telemetry/constants.ts`: canonical event/metric names.
- `packages/core/src/config/configConstructor.ts`: calls `initializeTelemetry`.
- `scripts/local_telemetry.js`: local collector development script (writes
  settings only; SDK does not emit OTLP).
