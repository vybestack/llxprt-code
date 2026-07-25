# LLxprt Code Telemetry

LLxprt Code includes an OpenTelemetry (OTEL) instrumentation layer that can
emit traces, metrics, and logs for local debugging. **Telemetry is disabled by
default (`telemetry.enabled` defaults to `false`) and all output stays on your
local machine.**

This page covers OTEL telemetry (traces, metrics, logs). For conversation
logging (the `/logging` command), see
[Telemetry Privacy](./telemetry-privacy.md).

## What telemetry does

When enabled, the OpenTelemetry SDK registers **only `HttpInstrumentation`** —
it does not create custom spans for tool calls or model responses. The data
emitted is:

- **Traces**: HTTP request/response spans (auto-instrumented by
  `HttpInstrumentation`). There are no custom `startSpan` calls for tool calls
  or API interactions.
- **Metrics**: session counts, tool call counts/latency, API request
  counts/latency, token usage, file operation counts.
- **Logs**: configuration events, user prompts (if `logPrompts` is enabled),
  tool calls, hook calls, API requests/responses/errors, slash commands.

All data is written locally — to a file if you configure an outfile, or to the
console otherwise. **No data is sent to any external service.** There are no
OTLP or network exporters in the telemetry code path (the SDK constructs only
`File*Exporter` or `Console*Exporter`).

## Enable telemetry

Telemetry is controlled by the `telemetry.enabled` setting.

| Property    | Value                               |
| ----------- | ----------------------------------- |
| Default     | `false` (disabled)                  |
| Scope       | User settings or workspace settings |
| Persistence | Saved in `settings.json`            |
| Precedence  | CLI flags override settings files   |

To enable telemetry, add the following to your
[user settings](./reference/application-directories.md) or workspace
`.llxprt/settings.json`:

```json
{
  "telemetry": {
    "enabled": true
  }
}
```

You can also enable it for a single session with the CLI flag:

```bash
llxprt --telemetry "your prompt"
```

CLI flags take precedence over settings files. Specifically, the configuration
builder resolves the effective value as `argv.telemetry ?? settings.telemetry.enabled`
— a CLI flag wins if present, otherwise the persisted setting is used. See
[Configuration](./cli/configuration.md) for the full settings reference.

### Where output goes

| Configuration                       | Output destination                                     |
| ----------------------------------- | ------------------------------------------------------ |
| `--telemetry-outfile=/path/to/file` | All traces, metrics, and logs are written to that file |
| No outfile configured               | Data is written to the console (stdout/stderr)         |

To write telemetry to a file:

```bash
llxprt --telemetry --telemetry-outfile=/tmp/llxprt-telemetry.log "your prompt"
```

## Verify telemetry is working

1. Enable telemetry and start a session.
2. Run any prompt that triggers a tool call or API request.
3. Check the output:
   - **File**: inspect the outfile with `cat` or `jq`.
   - **Console**: look for OTEL span/log output in the terminal.

## Disable telemetry

Telemetry defaults to off, so simply not enabling it is sufficient. If
telemetry is enabled in your persisted settings (`settings.json`), omitting
`--telemetry` on the command line does **not** disable it — the persisted
setting still applies (the builder uses `argv.telemetry ?? settings.telemetry.enabled`).
To explicitly disable telemetry for a single session regardless of persisted
settings, use `--no-telemetry`:

```bash
llxprt --no-telemetry "your prompt"
```

To disable it permanently, remove `telemetry.enabled` from your settings (or
set it to `false`).

## Privacy

- **No external transmission**: OTLP/network exporters are absent from the code.
  Data goes only to the configured file or console.
- **No data sent to Google**: LLxprt Code never sends telemetry to Google.
- **Prompt logging**: the `telemetry.logPrompts` setting controls whether user
  prompt **text** is included in the `llxprt_code.user_prompt` log event.
  Default is `true`; set it to `false` to redact prompt content from that
  specific log event. Note: `logPrompts: false` does **not** redact hook
  input/output data (the `llxprt_code.hook_call` event always includes
  `hook_input` and `hook_output` fields regardless of this setting).

## Logs and metrics reference

The following events and metrics are emitted when telemetry is enabled. All
event and metric names use the `llxprt_code.*` prefix (the service name is
`llxprt-code`, but the telemetry identifiers use underscores):

### Logs (event names)

- `llxprt_code.config`: startup configuration (model, sandbox, approval mode, etc.)
- `llxprt_code.user_prompt`: user prompt submission (length; prompt text if
  `logPrompts` is enabled)
- `llxprt_code.tool_call`: each tool call (function, args, duration, success)
- `llxprt_code.hook_call`: hook execution (event name, input, output, duration)
- `llxprt_code.api_request`: provider API request
- `llxprt_code.api_error`: provider API error
- `llxprt_code.api_response`: provider API response (token counts, latency)
- `llxprt_code.slash_command`: slash command execution
- `llxprt_code.next_speaker_check`: next-speaker determination
- `llxprt_code.conversation_request`: conversation API request
- `llxprt_code.conversation_response`: conversation API response
- `llxprt_code.enhanced_conversation_response`: enhanced conversation response
- `llxprt_code.provider_switch`: provider switch event
- `llxprt_code.provider_capability`: provider capability report
- `llxprt_code.tool_output_truncated`: tool output truncation event
- `llxprt_code.file_operation`: file system operation
- `llxprt_code.malformed_json_response`: malformed JSON from provider
- `llxprt_code.model_routing`: model routing decision
- `llxprt_code.extension_install`: extension installed
- `llxprt_code.extension_uninstall`: extension uninstalled
- `llxprt_code.extension_enable`: extension enabled
- `llxprt_code.extension_disable`: extension disabled

### Metrics

- `llxprt_code.session.count` (counter): incremented once per startup
- `llxprt_code.tool.call.count` (counter): tool call counts
- `llxprt_code.tool.call.latency` (histogram, ms): tool call latency
- `llxprt_code.api.request.count` (counter): API request counts
- `llxprt_code.api.request.latency` (histogram, ms): API request latency
- `llxprt_code.token.usage` (counter): token usage by type (input, output, etc.)
- `llxprt_code.file.operation.count` (counter): file operation counts

## Internals

For implementation details — the NodeSDK configuration, exporter selection
logic, batch processor settings, and why the local OTEL collector script cannot
receive data — see
[Telemetry Internals](../dev-docs/telemetry-internals.md).
