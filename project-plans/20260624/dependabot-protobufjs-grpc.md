# Dependabot — protobufjs / @protobufjs/utf8 / @grpc/grpc-js (14 alerts)

| Alerts | Package | Sev | Notable GHSA |
| --- | --- | --- | --- |
| 115, 134, 135, 136, 137, 138, 139, 140, 145, 178, 179 | protobufjs | critical/high/medium | GHSA-xq3m-2v4x-88gg (critical, prototype pollution) |
| 133 | @protobufjs/utf8 | medium | GHSA-q6x5-8v7m-xcrf |
| 165, 166 | @grpc/grpc-js | high | GHSA-99f4-grh7-6pcq, GHSA-5375-pq7m-f5r2 |

## Root cause

These arrive **transitively** through the gRPC/OTLP exporter stack (the OTEL
gRPC exporters depend on `@grpc/grpc-js`, which depends on `protobufjs`, which
depends on `@protobufjs/utf8`). None is a direct first-party dependency, so the
fix is at the lockfile level.

## Fix — root `overrides` (transitive)

    "overrides": {
      "protobufjs": ">=7.6.3 <8",
      "@protobufjs/utf8": ">=1.1.1",
      "@grpc/grpc-js": ">=1.13.5 <2"
    }

- `protobufjs >=7.6.3 <8` clears the critical prototype-pollution advisory and
  the rest of the `7.x` tail while staying in major 7 (resolved `7.6.4`).
- `@protobufjs/utf8 >=1.1.1` is a tiny leaf with a patched `1.1.x`.
- `@grpc/grpc-js >=1.13.5 <2` clears both high advisories within major 1.

All three are same-major bumps (no breaking change to the OTLP gRPC path).

## Verification

Installed `protobufjs@7.6.4`. `_reconcile.cjs` confirms all 14 alerts FIXED.
