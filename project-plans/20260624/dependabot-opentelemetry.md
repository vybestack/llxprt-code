# Dependabot — OpenTelemetry + @hono/node-server (alerts 104, 130, 131, 164, 180, 187)

| Alert | Package | Sev | GHSA |
| --- | --- | --- | --- |
| 164 | @opentelemetry/sdk-node | high | GHSA-q7rr-3cgh-j5r3 |
| 131 | @opentelemetry/sdk-node | high | GHSA-q7rr-3cgh-j5r3 |
| 130 | @opentelemetry/exporter-prometheus | high | GHSA-q7rr-3cgh-j5r3 |
| 187 | @opentelemetry/core | medium | GHSA-8988-4f7v-96qf |
| 180 | @opentelemetry/core | medium | GHSA-8988-4f7v-96qf |
| 104 | @hono/node-server | medium | GHSA-92pp-h63x-v22m |

## Root cause

The `@opentelemetry/*` advisories are reachable through the OTEL stack declared
directly in `packages/telemetry/package.json`, which was pinned to the
`0.203.x` (experimental) / `1.26 / 2.0` (stable) lines. `@hono/node-server` is a
**direct** dependency of the root `package.json`.

## Fix — direct bumps (preferred over overrides)

Because these are first-party direct dependencies, the version ranges were
raised directly in the owning manifests.

`packages/telemetry/package.json`:

- `@opentelemetry/api-logs`, `sdk-logs`, `sdk-node`, `exporter-*-otlp-*`,
  `instrumentation-http` : `^0.203.0 -> ^0.219.0`
- `@opentelemetry/core`, `resources`, `sdk-metrics`, `sdk-trace-base`,
  `sdk-trace-node` : `^1.26 / ^2.0 -> ^2.8.0`
- `@opentelemetry/semantic-conventions` : `^1.26.0 -> ^1.29.0`

Root `package.json`:

- `@hono/node-server` : `^1.19.7 -> ^1.19.13`

`@hono/node-server` is **not** also added to `overrides` (an override for a
package that is also a root direct dependency triggers npm `EOVERRIDE`); the
direct bump is sufficient.

## Verification

`_reconcile.cjs` confirms all six alerts FIXED: no installed `@opentelemetry/*`
or `@hono/node-server` version remains within the advisories' vulnerable ranges.

## Follow-on build work

The OTEL `0.203 -> 0.219` jump added a required `forceFlush()` to the
`LogRecordExporter` interface, which required a code change in
`packages/telemetry/src/telemetry/file-exporters.ts`. See
`build-regressions-from-bumps.md`.
