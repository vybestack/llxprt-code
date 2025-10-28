# PLAN-20251028-STATELESS6 – Integration Map (P03)

> @plan PLAN-20251028-STATELESS6.P03

| Component | Current Dependencies | Target (Post-Plan) |
|-----------|---------------------|--------------------|
| `GeminiChat` | `config.getProviderManager`, `config.getSettingsService`, `config.getEphemeralSetting`, telemetry helpers requiring Config, tool registry | Consume `GeminiRuntimeView` providing provider registry adapter, read-only ephemerals/compression, telemetry sink, diagnostics info. |
| `SubAgentScope` | Mutates `runtimeContext` (Config) via `setModel`, relies on Config-backed content generator/history | Accept pre-built runtime view + isolated history; no Config mutation; content generator bridge uses runtime view metadata. |
| Telemetry/Tool Logging | `logApiRequest/Response/Error(config, …)` | Logging APIs accept metadata extracted from runtime view (provider, model, session, auth). |
