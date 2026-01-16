# LLxprt Code Telemetry Guide (Disabled by Default)

**Important:** LLxprt Code has telemetry disabled by default. No data is collected or sent to Google or any external service. The telemetry system is only available for your own local debugging and monitoring if you explicitly enable it.

## Current Status

Telemetry is currently **disabled** in the LLxprt Code codebase. The telemetry initialization code has been commented out to ensure no data collection occurs. If you need telemetry for local debugging:

1. Telemetry must be explicitly enabled in your settings
2. All data stays on your local machine unless you configure an external endpoint
3. No data is ever sent to Google

The telemetry infrastructure is based on the **[OpenTelemetry] (OTEL)** standard, which would allow you to send data to any compatible backend that you control, if you choose to re-enable it.

[OpenTelemetry]: https://opentelemetry.io/

## Enabling telemetry

Telemetry configuration is managed via settings files and environment variables. The recommended approach is to configure telemetry in your [settings files](./cli/configuration.md).

### Configuration methods

Configure telemetry using one of the following methods:

1.  **Settings files (recommended):**
    - **User settings file (`~/.llxprt/settings.json`):** Global configuration for all projects.
    - **Workspace settings file (`.llxprt/settings.json`):** Project-specific configuration.

    Add a `telemetry` object to your settings file (see [Example settings](#example-settings) below).

2.  **Environment variables:**
    - `OTEL_EXPORTER_OTLP_ENDPOINT`: Sets the OTLP endpoint URL.

3.  **CLI flags:** Available for temporary overrides during specific sessions, but settings files are the preferred method for persistent configuration.

### Order of precedence

When multiple configuration methods are used, settings are applied in the following order (highest precedence first):

1.  **CLI flags** (temporary session overrides)
2.  **Environment variables**
3.  **Workspace settings file (`.llxprt/settings.json`)**
4.  **User settings file (`~/.llxprt/settings.json`)**
5.  **Defaults:**
    - `telemetry.enabled`: `false`
    - `telemetry.target`: `local`
    - `telemetry.otlpEndpoint`: `http://localhost:4317`
    - `telemetry.logPrompts`: `true`

**Note:** The telemetry scripts (`npm run telemetry`) are provided for development purposes but will not collect any data unless you manually re-enable telemetry in the source code. Even then, the `local` target ensures data stays on your machine, while the `gcp` target would require your own Google Cloud project - LLxprt Code never sends data to Google's telemetry systems.

**CLI flags reference:** For temporary session overrides, CLI flags are available (e.g., `--telemetry`, `--telemetry-target`, `--telemetry-otlp-endpoint`, `--telemetry-log-prompts`, `--telemetry-outfile`). However, for persistent configuration, use settings files as described above.

### Example settings

The following code can be added to your workspace (`.llxprt/settings.json`) or user (`~/.llxprt/settings.json`) settings to enable telemetry for local debugging only:

```json
{
  "telemetry": {
    "enabled": true,
    "target": "local"
  }
}
```

**Important:** Even with these settings, telemetry will not function unless you modify the source code to re-enable it. This is intentional to ensure no accidental data collection.

### Exporting to a file

You can export all telemetry data to a file for local inspection using the `--telemetry-outfile` CLI flag as a temporary override. This must be used with `--telemetry-target=local`.

Example:

```bash
llxprt --telemetry --telemetry-target=local --telemetry-outfile=/path/to/telemetry.log "your prompt"
```

## Running an OTEL Collector

An OTEL Collector is a service that receives, processes, and exports telemetry data.
The CLI sends data using the OTLP/gRPC protocol.

Learn more about OTEL exporter standard configuration in [documentation][otel-config-docs].

[otel-config-docs]: https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/

### Local

Use the `npm run telemetry -- --target=local` command to set up a local telemetry pipeline for development purposes. Note that telemetry is disabled in the code, so this will not collect any data unless you manually re-enable it. The script installs `otelcol-contrib` (the OpenTelemetry Collector) and `jaeger` (The Jaeger UI for viewing traces) locally. To use it:

1.  **Run the command**:
    Execute the command from the root of the repository:

    ```bash
    npm run telemetry -- --target=local
    ```

    The script will:
    - Download Jaeger and OTEL if needed.
    - Start a local Jaeger instance.
    - Start an OTEL collector configured to receive data from LLxprt Code.
    - Automatically enable telemetry in your workspace settings.
    - On exit, disable telemetry.

1.  **View traces**:
    Open your web browser and navigate to **http://localhost:16686** to access the Jaeger UI. Here you can inspect detailed traces of LLxprt Code operations.

1.  **Inspect logs and metrics**:
    The script redirects the OTEL collector output (which includes logs and metrics) to `~/.llxprt/tmp/<projectHash>/otel/collector.log`. The script will provide links to view and a command to tail your telemetry data (traces, metrics, logs) locally.

1.  **Stop the services**:
    Press `Ctrl+C` in the terminal where the script is running to stop the OTEL Collector and Jaeger services.

### Google Cloud (Not Recommended)

**Important:** LLxprt Code does not send telemetry to Google. The GCP target is only provided if you want to send telemetry to your own Google Cloud project for your own purposes. This is not recommended for normal use.

The `npm run telemetry -- --target=gcp` command sets up a local OpenTelemetry collector that could forward data to your own Google Cloud project. Remember that telemetry is disabled in the code, so no data will be sent unless you manually re-enable it. To use it:

1.  **Prerequisites**:
    - Have a Google Cloud project ID.
    - Export the `GOOGLE_CLOUD_PROJECT` environment variable to make it available to the OTEL collector.
      ```bash
      export OTLP_GOOGLE_CLOUD_PROJECT="your-project-id"
      ```
    - Authenticate with Google Cloud (e.g., run `gcloud auth application-default login` or ensure `GOOGLE_APPLICATION_CREDENTIALS` is set).
    - Ensure your Google Cloud account/service account has the necessary IAM roles: "Cloud Trace Agent", "Monitoring Metric Writer", and "Logs Writer".

1.  **Run the command**:
    Execute the command from the root of the repository:

    ```bash
    npm run telemetry -- --target=gcp
    ```

    The script will:
    - Download the `otelcol-contrib` binary if needed.
    - Start an OTEL collector configured to receive data from LLxprt Code and export it to your specified Google Cloud project.
    - Automatically enable telemetry in your workspace settings (`.llxprt/settings.json`).
    - Provide direct links to view traces, metrics, and logs in your Google Cloud Console.
    - On exit (Ctrl+C), it will attempt to restore your original telemetry and sandbox settings.

1.  **Run LLxprt Code:**
    In a separate terminal, run your LLxprt Code commands. This generates telemetry data that the collector captures.

1.  **View telemetry in Google Cloud**:
    Use the links provided by the script to navigate to the Google Cloud Console and view your traces, metrics, and logs.

1.  **Inspect local collector logs**:
    The script redirects the local OTEL collector output to `~/.llxprt/tmp/<projectHash>/otel/collector-gcp.log`. The script provides links to view and command to tail your collector logs locally.

1.  **Stop the service**:
    Press `Ctrl+C` in the terminal where the script is running to stop the OTEL Collector.

## Logs and metric reference

The following section describes the structure of logs and metrics generated for LLxprt Code.

- A `sessionId` is included as a common attribute on all logs and metrics.

### Logs

Logs are timestamped records of specific events. The following events are logged for LLxprt Code:

- `llxprt_cli.config`: This event occurs once at startup with the CLI's configuration.
  - **Attributes**:
    - `model` (string)
    - `embedding_model` (string)
    - `sandbox_enabled` (boolean)
    - `core_tools_enabled` (string)
    - `approval_mode` (string)
    - `api_key_enabled` (boolean)
    - `vertex_ai_enabled` (boolean)
    - `code_assist_enabled` (boolean)
    - `log_prompts_enabled` (boolean)
    - `file_filtering_respect_git_ignore` (boolean)
    - `debug_mode` (boolean)
    - `mcp_servers` (string)

- `llxprt_cli.user_prompt`: This event occurs when a user submits a prompt.
  - **Attributes**:
    - `prompt_length`
    - `prompt` (this attribute is excluded if `log_prompts_enabled` is configured to be `false`)
    - `auth_type`

- `llxprt_cli.tool_call`: This event occurs for each function call.
  - **Attributes**:
    - `function_name`
    - `function_args`
    - `duration_ms`
    - `success` (boolean)
    - `decision` (string: "accept", "reject", "auto_accept", or "modify", if applicable)
    - `error` (if applicable)
    - `error_type` (if applicable)
    - `metadata` (if applicable, dictionary of string -> any)

- `llxprt_cli.api_request`: This event occurs when making a request to a provider API.
  - **Attributes**:
    - `model`
    - `request_text` (if applicable)

- `llxprt_cli.api_error`: This event occurs if the API request fails.
  - **Attributes**:
    - `model`
    - `error`
    - `error_type`
    - `status_code`
    - `duration_ms`
    - `auth_type`

- `llxprt_cli.api_response`: This event occurs upon receiving a response from a provider API.
  - **Attributes**:
    - `model`
    - `status_code`
    - `duration_ms`
    - `error` (optional)
    - `input_token_count`
    - `output_token_count`
    - `cached_content_token_count`
    - `thoughts_token_count`
    - `tool_token_count`
    - `response_text` (if applicable)
    - `auth_type`

  - **Attributes**:
    - `auth_type`

- `llxprt_cli.slash_command`: This event occurs when a user executes a slash command.
  - **Attributes**:
    - `command` (string)
    - `subcommand` (string, if applicable)

### Metrics

Metrics are numerical measurements of behavior over time. The following metrics are collected for LLxprt Code:

- `llxprt_cli.session.count` (Counter, Int): Incremented once per CLI startup.

- `llxprt_cli.tool.call.count` (Counter, Int): Counts tool calls.
  - **Attributes**:
    - `function_name`
    - `success` (boolean)
    - `decision` (string: "accept", "reject", or "modify", if applicable)
    - `tool_type` (string: "mcp", or "native", if applicable)

- `llxprt_cli.tool.call.latency` (Histogram, ms): Measures tool call latency.
  - **Attributes**:
    - `function_name`
    - `decision` (string: "accept", "reject", or "modify", if applicable)

- `llxprt_cli.api.request.count` (Counter, Int): Counts all API requests.
  - **Attributes**:
    - `model`
    - `status_code`
    - `error_type` (if applicable)

- `llxprt_cli.api.request.latency` (Histogram, ms): Measures API request latency.
  - **Attributes**:
    - `model`

- `llxprt_cli.token.usage` (Counter, Int): Counts the number of tokens used.
  - **Attributes**:
    - `model`
    - `type` (string: "input", "output", "thought", "cache", or "tool")

- `llxprt_cli.file.operation.count` (Counter, Int): Counts file operations.
  - **Attributes**:
    - `operation` (string: "create", "read", "update"): The type of file operation.
    - `lines` (Int, if applicable): Number of lines in the file.
    - `mimetype` (string, if applicable): Mimetype of the file.
    - `extension` (string, if applicable): File extension of the file.
    - `ai_added_lines` (Int, if applicable): Number of lines added/changed by AI.
    - `ai_removed_lines` (Int, if applicable): Number of lines removed/changed by AI.
    - `user_added_lines` (Int, if applicable): Number of lines added/changed by user in AI proposed changes.
    - `user_removed_lines` (Int, if applicable): Number of lines removed/changed by user in AI proposed changes.
