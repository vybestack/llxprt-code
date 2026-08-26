# Ephemeral Settings Reference

Complete reference for all ephemeral settings. Set with `/set <key> <value>` during a session or `--set <key>=<value>` at startup. Ephemeral settings don't persist to `settings.json` — they live only for the current session unless saved to a profile with `/profile save`.

For guidance on tuning these for specific models, see [Settings and Profiles](../settings-and-profiles.md).

## Reasoning

Control provider-neutral reasoning behavior and select the request shape used by
the active provider and transport.

| Setting                       | Type    | Default          | Profile | Description                                                                                                                                                    |
| ----------------------------- | ------- | ---------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reasoning.enabled`           | boolean | `false`          | yes     | Turn thinking mode on or off. Some models cannot disable thinking.                                                                                             |
| `reasoning.effort`            | enum    | provider default | yes     | Generic effort: `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Model-specific maps can normalize this value before it is sent.                         |
| `reasoning.effortWireFormat`  | enum    | `auto`           | yes     | Effort request shape: `auto`, `openai`, `openai-responses`, `anthropic`, `anthropic-budget`, `openrouter`, `gemini`, `template-kwargs`, or `none`.             |
| `reasoning.enabledWireFormat` | enum    | `auto`           | yes     | Enablement request shape: `auto`, `openai`, `openai-responses`, `openrouter`, `thinking`, `gemini`, `template-kwargs`, or `none`.                              |
| `reasoning.effortMap`         | JSON    | no map           | yes     | Object with optional `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` keys. Values are non-empty strings, integer budgets of at least `1024`, or `null`. |
| `reasoning.enabledMap`        | JSON    | no map           | yes     | Object with optional `true` and `false` keys. Values are non-empty strings, booleans, or `null`.                                                               |
| `reasoning.maxTokens`         | number  | none             | yes     | Set a native reasoning token limit where the provider supports one.                                                                                            |
| `reasoning.budgetTokens`      | number  | none             | yes     | Direct Anthropic thinking budget. It takes precedence over a numeric effort map. No universal conversion from generic effort to budget tokens exists.          |
| `reasoning.adaptiveThinking`  | boolean | `false`          | yes     | Let supported Anthropic models choose a thinking budget. Some Claude model defaults enable it.                                                                 |
| `reasoning.includeInResponse` | boolean | `true`           | yes     | Show thinking blocks in the terminal.                                                                                                                          |
| `reasoning.includeInContext`  | boolean | `true`           | yes     | Keep thinking in conversation history sent to the model.                                                                                                       |
| `reasoning.stripFromContext`  | enum    | `none`           | yes     | Prune old thinking: `none`, `allButLast`, or `all`.                                                                                                            |
| `reasoning.format`            | enum    | none             | yes     | Response reasoning format: `native` or `field`.                                                                                                                |
| `reasoning.summary`           | enum    | none             | yes     | OpenAI Responses reasoning summary: `auto`, `concise`, `detailed`, or `none`. Codex defaults to `auto`.                                                        |
| `text.verbosity`              | enum    | none             | yes     | OpenAI Responses text verbosity: `low`, `medium`, or `high`.                                                                                                   |

### Reasoning request translation

The four wire-format translation settings are supported model-behavior
settings. They remain session-only until saved with `/profile save`, then
persist in the profile's `ephemeralSettings` object.

Each selector and map resolves in this order, highest precedence first:

1. An explicit profile or session value
2. The last matching model default from the provider alias
3. The provider alias default
4. `auto` for selectors, or no map for maps

A higher-precedence map replaces the lower-precedence map as a whole. Maps are
not recursively merged. In a partial string effort map, a missing effort key
uses the original generic effort string. `anthropic-budget` instead requires a
numeric mapped value or direct `reasoning.budgetTokens`.

Under `auto`, OpenAI Responses, Codex, native Anthropic, native Gemini,
OpenRouter Chat, Z.AI Chat, and BigModel Chat select their owned request shapes.
The official `api.openai.com` Chat endpoint selects top-level
`reasoning_effort`. An unknown OpenAI-compatible Chat endpoint selects `none`.
This avoids sending fields that a strict custom endpoint may reject. Select a
format explicitly when you know the server's accepted request shape.

`none` and a selected `null` map entry deliberately omit the generic control and
produce a warning. `reasoning.enabled=false` suppresses effort. If the selected
format or model has no disable form, LLxprt Code omits both controls and warns.

Explicit native reasoning fields in `modelParams` remain authoritative. When a
native field collides with translation, LLxprt Code leaves it unchanged and
adds no competing reasoning representation. Unrelated nested siblings are
merged where supported. LLxprt Code does not send several reasoning formats in
one request.

See [Reasoning Wire Formats](../providers/reasoning-wire-formats.md) for selector
compatibility, exact request shapes, model restrictions, warnings, and profile
examples.

## Context and Compression

Control how much context the model sees and when/how history is compressed. These directly affect quality — too small and the model loses track; too large and it drowns in noise.

| Setting                                 | Type    | Default          | Profile | Description                                                                                                                                                     |
| --------------------------------------- | ------- | ---------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context-limit`                         | number  | model default    | yes     | Max tokens for the entire context window (system prompt + history + tool output). Set lower than the model's max to leave headroom.                             |
| `compression-threshold`                 | number  | model default    | yes     | Fraction of `context-limit` that triggers compression (0.0–1.0). E.g., `0.7` means compress when 70% full. Lower = more frequent compression but more headroom. |
| `max-prompt-tokens`                     | number  | `200000`         | yes     | Hard ceiling on any single prompt to the API. Safety net to prevent runaway costs.                                                                              |
| `maxOutputTokens`                       | number  | —                | yes     | Max output tokens per response (generic, translated by provider). Anthropic alias sets this to `40000`. Limits how much the model writes per turn.              |
| `compression.strategy`                  | enum    | `middle-out`     | yes     | Compression algorithm: `middle-out` (LLM-summarizes middle turns) or `top-down-truncation` (drops oldest turns).                                                |
| `compression.profile`                   | string  | —                | yes     | Profile to use for compression LLM calls. Lets you use a cheaper model for summarization.                                                                       |
| `compression.density.readWritePruning`  | boolean | `true`           | yes     | Drop read-file results when the file was subsequently written. Reduces noise from obsolete reads.                                                               |
| `compression.density.fileDedupe`        | boolean | `true`           | yes     | Deduplicate repeated `@file` inclusions.                                                                                                                        |
| `compression.density.recencyPruning`    | boolean | `false`          | yes     | Keep only the N most recent results per tool type. Aggressive — enable only for very long sessions.                                                             |
| `compression.density.recencyRetention`  | number  | `3`              | yes     | How many recent results to keep per tool type when `recencyPruning` is on.                                                                                      |
| `compression.density.compressHeadroom`  | number  | `0.6`            | yes     | Multiplier for compression target (0–1). Lower = more aggressive compression.                                                                                   |
| `compression.density.optimizeThreshold` | number  | strategy default | yes     | Context usage fraction that triggers density optimization.                                                                                                      |

## Tool Output Limits

Prevent tools from flooding the context. Applied to all tools via the batch scheduler. See [Settings and Profiles](../settings-and-profiles.md#tool-output-limits) for how these interact.

| Setting                       | Type   | Default                           | Profile | Description                                                                                                                                                                 |
| ----------------------------- | ------ | --------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool-output-max-items`       | number | 50 (read-many-files), 1000 (grep) | yes     | Max files/matches per tool call. Lower to force the model to be more surgical.                                                                                              |
| `tool-output-max-tokens`      | number | `50000`                           | yes     | Max tokens across tool output in a batch. Split across concurrent tool calls.                                                                                               |
| `tool-output-truncate-mode`   | enum   | `warn`                            | yes     | What happens when output exceeds limits. `warn` = drop output entirely, tell model to narrow query. `truncate` = cut to fit silently. `sample` = pick representative lines. |
| `tool-output-item-size-limit` | number | `524288` (512KB)                  | yes     | Max bytes per individual file/item. Prevents one huge file from consuming the budget.                                                                                       |
| `file-read-max-lines`         | number | `2000`                            | yes     | Default max lines when reading a text file with no explicit limit. Prevents accidentally reading massive files.                                                             |

## Image Resizing

`read_file` and explicitly requested images in `read_many_files` automatically downscale images when an effective model or profile limit is present. The fit preserves aspect ratio and never upscales. Images already within every configured limit are returned byte-for-byte without re-encoding. Resized PNG, JPEG, GIF, and WebP inputs retain their MIME type and container; animated GIF/WebP inputs retain their frame count. Resize-required corrupt images and unsupported containers fail clearly rather than returning oversized originals.

| Setting                     | Type    | Default       | Profile | Description                                                                                        |
| --------------------------- | ------- | ------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `image-resize.enabled`      | boolean | model default | yes     | Set `false` to disable automatic image resizing, including model defaults, and preserve originals. |
| `image-resize.maxLongEdge`  | number  | model default | yes     | Positive integer maximum for the orientation-independent longer edge, in pixels.                   |
| `image-resize.maxShortEdge` | number  | model default | yes     | Positive integer maximum for the orientation-independent shorter edge, in pixels.                  |
| `image-resize.maxPixels`    | number  | model default | yes     | Positive integer maximum decoded pixel count.                                                      |

Built-in visual-model aliases provide conservative advisory defaults: Claude Opus/Sonnet use `1568`/`1568`/`1229312`; OpenAI `gpt-*` uses `2048`/`2048`/`1572864`; Kimi uses `4096`/`2160`/`8847360` (long edge/short edge/pixels). These are useful-resolution targets, not universal provider hard limits. Explicit profile values take precedence over model defaults. When no limit is configured, image reads retain legacy byte-for-byte behavior. Setting `image-resize.enabled false` disables all automatic limits for the profile. For one `read_file` call, pass `skip_image_resize: true` to return the original image; `read_many_files` has no per-call opt-out.

## Hard Image Dimension Budget

In addition to advisory image resizing, `max-image-dimension` and `max-image-pixels` define **hard** limits that reject oversized image bytes with an actionable tool error before they reach the model. Unlike `image-resize.*` (which silently downscales), these settings cause `read_file`, `read_many_files`, and `generate_image` to return a structured error message instructing the model to create a smaller thumbnail. For `generate_image`, the budget check runs after the generated image is written to its `output_path`; an oversized result is reported as a `policy_violation` tool error (no inline bytes enter the conversation), but the saved file is retained and the error names its path so the model can downscale/thumbnail it before reading.

Explicit `image-resize.*` resizing runs **first**; the hard check runs **after**, so a resized image within budget passes through normally. Only images whose post-resize dimensions still exceed the budget are rejected.

| Setting               | Type   | Default | Profile | Description                                                                                                       |
| --------------------- | ------ | ------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `max-image-dimension` | number | —       | yes     | Positive integer maximum for image width/height in pixels. Oversized images return a tool error instead of bytes. |
| `max-image-pixels`    | number | —       | yes     | Positive integer maximum total decoded pixel count. Oversized images return a tool error instead of bytes.        |

When neither key is set, no hard budget is enforced and image reads follow legacy/resize behavior. Both keys are independent: set one or both. Invalid values (zero, negatives, non-integers) are rejected by the settings registry.

**claudecode alias defaults:** The claudecode OAuth alias applies `max-image-dimension: 2000` to `claude-opus-5`, `claude-opus-4-8`, and `claude-sonnet-5` only. These three models also do **not** receive implicit `image-resize.*` defaults (so a 3000-pixel image is hard-rejected, not silently downscaled). Older claudecode Opus/Sonnet models keep the advisory `1568`/`1568`/`1229312` resize defaults and no hard cap. Direct `anthropic` alias Opus/Sonnet models also keep the advisory resize defaults.

## Shell Output Acquisition

| Setting                            | Type   | Default   | Profile | Description                                                                                                                                                                   |
| ---------------------------------- | ------ | --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell-output-retention-max-bytes` | number | `4194304` | yes     | Maximum shell-output bytes retained during command execution. Excess output keeps draining but is retained as bounded head/tail data. `-1` selects the finite 64 MiB ceiling. |

This acquisition-time byte bound protects process memory before model-facing token truncation runs. Values below 1024 bytes are raised to 1024, and values above 64 MiB are clamped to the hard ceiling.

## Timeouts

Prevent commands and tasks from hanging indefinitely. In seconds (not milliseconds, despite older docs).

| Setting                            | Type        | Default         | Profile | Description                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ----------- | --------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell-default-timeout-seconds`    | number      | `300` (5 min)   | yes     | Default timeout for shell commands. The model can request a specific timeout, but this applies when it doesn't. `-1` means unlimited (subject to the maximum below).                                                                                                             |
| `shell-max-timeout-seconds`        | number      | `900` (15 min)  | yes     | Ceiling only — bounds a request upward but never overrides a shorter one. A model request above this (including a `-1` "unlimited" request) is clamped to this value and the result says so. Set to `-1` to decline a ceiling entirely (genuinely unbounded).                    |
| `shell-inactivity-timeout-seconds` | number      | — (disabled)    | yes     | Kill commands that produce no output for this long. Resets on each output line. Good for catching commands that hang waiting for input.                                                                                                                                          |
| `task-default-timeout-seconds`     | number      | `900` (15 min)  | yes     | Default timeout for subagent tasks. `-1` means unlimited (subject to the maximum below).                                                                                                                                                                                         |
| `task-max-timeout-seconds`         | number      | `1800` (30 min) | yes     | Ceiling only for subagent tasks — bounds a request upward but never overrides a shorter one. A model request above this (including a `-1` "unlimited" request) is clamped to this value and the result says so. Set to `-1` to decline a ceiling entirely (genuinely unbounded). |
| `socket-timeout`                   | number (ms) | —               | yes     | HTTP request timeout for API calls, in milliseconds. Useful for slow local models.                                                                                                                                                                                               |

## Loop Detection

Catch models that get stuck repeating the same action.

| Setting                            | Type    | Default                       | Profile | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ------- | ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxTurnsPerPrompt`                | number  | `-1` (unlimited)              | yes     | Hard limit on turns per prompt. Set to a positive integer to cap runaway sessions. The foreground loop-detection layer independently treats an absent value as `-1` (unlimited). Subagents, however, only inherit a **currently materialized valid foreground value** — explicitly stored `-1` is inherited as unlimited, but absent/invalid (NaN, Infinity, non-number, zero) causes the orchestrator to fall back to a subagent-specific cap of **1000** turns. The 1000-turn fallback is a fixed constant and does not interpret `-1`. |
| `subagent-max-output-tokens-total` | number  | derived, clamped to `2000000` | yes     | Aggregate output-token budget for one subagent run. A turn cap alone does not bound a loop: a subagent emitting maximum-length responses stays inside every per-response limit. Default is `max_turns` times the resolved model output ceiling, clamped to 2,000,000; the clamp matters because the unclamped product reproduces the bound it is meant to replace. `-1` disables. Exceeding it terminates with `MAX_OUTPUT`.                                                                                                              |
| `loopDetectionEnabled`             | boolean | `true`                        | yes     | Master switch for all loop detection. Disable only if you're sure the model won't loop.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `toolCallLoopThreshold`            | number  | `50`                          | yes     | Consecutive identical tool calls before intervention. `-1` = unlimited.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `contentLoopThreshold`             | number  | `50`                          | yes     | Consecutive identical content chunks before intervention. `-1` = unlimited.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Streaming and Network

| Setting            | Type        | Default   | Profile | Description                                                                                   |
| ------------------ | ----------- | --------- | ------- | --------------------------------------------------------------------------------------------- |
| `streaming`        | enum        | `enabled` | yes     | `enabled` or `disabled`. Disable for providers that don't support streaming or for debugging. |
| `api-version`      | string      | —         | yes     | API version string. Required by some providers (e.g., Azure OpenAI).                          |
| `socket-keepalive` | boolean     | —         | yes     | TCP keepalive for local AI servers. Prevents idle connections from dropping.                  |
| `socket-nodelay`   | boolean     | —         | yes     | TCP_NODELAY for local AI servers. Reduces latency at the cost of more packets.                |
| `stream-options`   | JSON        | —         | yes     | Extra stream options passed to the OpenAI API (e.g., `{"include_usage": true}`).              |
| `retries`          | number      | —         | yes     | Max retry attempts for failed API calls.                                                      |
| `retrywait`        | number (ms) | —         | yes     | Initial delay between retries. Exponential backoff applies.                                   |

## Rate Limiting

Proactive throttling to stay within provider rate limits.

| Setting                         | Type        | Default | Profile | Description                                                                                                                        |
| ------------------------------- | ----------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `rate-limit-throttle`           | enum        | —       | yes     | `on` or `off`. When on, LLxprt proactively slows down before hitting rate limits.                                                  |
| `rate-limit-throttle-threshold` | number      | —       | yes     | Percentage of rate limit (1–100) to start throttling at.                                                                           |
| `rate-limit-max-wait`           | number (ms) | —       | yes     | Max time to wait for rate limit headroom before sending anyway.                                                                    |
| `prompt-caching`                | enum        | `off`   | yes     | Provider-side prompt caching: `off`, `5m`, `1h`, `24h`. Saves costs when repeating similar prompts. Codex alias defaults to `24h`. |

## Load Balancer

Settings for multi-endpoint load balancing. Only apply when using load-balanced provider configurations.

| Setting                               | Type        | Default | Profile | Description                                                         |
| ------------------------------------- | ----------- | ------- | ------- | ------------------------------------------------------------------- |
| `tpm_threshold`                       | number      | —       | yes     | Minimum tokens/minute before triggering failover to next endpoint.  |
| `timeout_ms`                          | number (ms) | —       | yes     | Max request duration before load balancer fails over.               |
| `circuit_breaker_enabled`             | boolean     | —       | yes     | Enable circuit breaker for failing backends.                        |
| `circuit_breaker_failure_threshold`   | number      | `3`     | yes     | Failures before opening the circuit (stop sending to that backend). |
| `circuit_breaker_failure_window_ms`   | number (ms) | `60000` | yes     | Time window for counting failures.                                  |
| `circuit_breaker_recovery_timeout_ms` | number (ms) | `30000` | yes     | Cooldown before retrying an opened circuit.                         |

## Subagent and Task Control

| Setting                   | Type    | Default | Profile | Description                                                                        |
| ------------------------- | ------- | ------- | ------- | ---------------------------------------------------------------------------------- |
| `task-max-async`          | number  | `5`     | yes     | Max concurrent async subagent tasks. `-1` = unlimited (up to 100).                 |
| `subagents.async.enabled` | boolean | `true`  | yes     | Enable/disable async subagent execution.                                           |
| `todo-continuation`       | boolean | —       | yes     | Enable todo continuation mode — model picks up where it left off from a todo list. |

## Tool Control

| Setting          | Type     | Default | Profile | Description                                                                     |
| ---------------- | -------- | ------- | ------- | ------------------------------------------------------------------------------- |
| `tools.disabled` | string[] | —       | yes     | List of tool names to disable. The model won't see these tools at all.          |
| `tools.allowed`  | string[] | —       | yes     | Allowlist — if set, only these tools are available. Overrides `tools.disabled`. |
| `tool_choice`    | string   | —       | yes     | Tool choice strategy sent to the API: `auto`, `required`, `none`.               |

## MCP Lazy Schema Loading

| Setting            | Type     | Default | Profile | Description                                                                                                                                                                                                                                                                                                                            |
| ------------------ | -------- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp.lazy`         | boolean  | `false` | yes     | Defer MCP server tool schemas from the model until a server is explicitly activated. The model receives an `activate_mcp_server` tool that lets it pick a server by name; only then are that server's full tool schemas published. MCP servers stay connected and discoverable — only the model-facing schema publication is deferred. |
| `mcp.eagerServers` | string[] | —       | yes     | Names of MCP servers that remain eager while `mcp.lazy` is enabled. Their schemas are always published regardless of lazy mode. Unknown server names are silently ignored.                                                                                                                                                             |

## Prompt Configuration

| Setting                    | Type    | Default | Profile | Description                                                                                                                                                           |
| -------------------------- | ------- | ------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enable-tool-prompts`      | boolean | `false` | yes     | Load tool-specific prompt files from `<config>/prompts/tools/` (see [Application Directories](./application-directories.md)). Adds specialized instructions per tool. |
| `include-folder-structure` | boolean | —       | yes     | Include the workspace folder tree in the system prompt. Helps the model navigate, but costs tokens.                                                                   |

## Custom Headers

| Setting          | Type   | Default | Profile | Description                                                                               |
| ---------------- | ------ | ------- | ------- | ----------------------------------------------------------------------------------------- |
| `custom-headers` | JSON   | —       | yes     | Custom HTTP headers as a JSON object. Applied to all API requests.                        |
| `user-agent`     | string | —       | yes     | Override the User-Agent header. Some providers (e.g., Kimi) require specific user agents. |

## Shell Behavior

| Setting             | Type   | Default | Profile | Description                                                                                                                                                       |
| ------------------- | ------ | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell-replacement` | string | —       | yes     | Command substitution mode: `allowlist` (safe subset), `all` (everything), `none`/`false` (disabled). Controls whether `$()` and backticks work in shell commands. |

## Authentication

| Setting          | Type    | Default | Profile | Description                                                                                                   |
| ---------------- | ------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `auth.noBrowser` | boolean | `false` | yes     | Skip automatic browser launch for OAuth. Use manual code entry instead. Useful for SSH/headless environments. |
| `authOnly`       | boolean | —       | yes     | Force OAuth-only authentication.                                                                              |

## Memory

| Setting                    | Type    | Default | Profile | Description                                                                                                                                                     |
| -------------------------- | ------- | ------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.canSaveCore`        | boolean | `false` | **no**  | Allow the model to write to `.LLXPRT_SYSTEM` (core system memory). **Unsafe** — the model can override your own directives. Not saved to profiles deliberately. |
| `model.allMemoriesAreCore` | boolean | `false` | yes     | Load `LLXPRT.md` files as part of the system prompt instead of user context. Makes the model treat your memories as hard directives rather than suggestions.    |

## Debugging

| Setting       | Type | Default | Profile | Description                                                                                                                                 |
| ------------- | ---- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `emojifilter` | enum | `auto`  | yes     | Emoji handling: `allowed`, `auto` (detect terminal support), `warn`, `error`.                                                               |
| `dumponerror` | enum | —       | yes     | Dump API request body to `<cache>/dumps/` on errors (see [Application Directories](./application-directories.md)): `enabled` or `disabled`. |
| `dumpcontext` | enum | —       | yes     | Context dumping: `now` (dump immediately), `status`, `on` (every turn), `error` (on errors), `off`.                                         |

## Model Parameters

These are passed directly to the provider API as-is. LLxprt doesn't validate them. Set with `/set modelparam <name> <value>`.

| Parameter           | Type     | Description                                                                                                                                                                                                                                       |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `temperature`       | number   | Sampling temperature (0.0–2.0). Lower = more deterministic.                                                                                                                                                                                       |
| `max_tokens`        | number   | Max tokens to generate (OpenAI/Anthropic). Alias: `maxTokens`.                                                                                                                                                                                    |
| `max_output_tokens` | number   | Max output tokens (Gemini native param).                                                                                                                                                                                                          |
| `top_p`             | number   | Nucleus sampling threshold.                                                                                                                                                                                                                       |
| `top_k`             | number   | Top-k sampling.                                                                                                                                                                                                                                   |
| `frequency_penalty` | number   | Penalize repeated tokens.                                                                                                                                                                                                                         |
| `presence_penalty`  | number   | Penalize tokens that appeared at all.                                                                                                                                                                                                             |
| `seed`              | number   | Random seed for deterministic output (OpenAI only).                                                                                                                                                                                               |
| `stop`              | string[] | Stop sequences — model stops generating when it produces any of these.                                                                                                                                                                            |
| `response_format`   | JSON     | Response format (e.g., `{"type": "json_object"}`).                                                                                                                                                                                                |
| `logit_bias`        | JSON     | Per-token bias.                                                                                                                                                                                                                                   |
| `reasoning`         | JSON     | OpenAI reasoning config object. Keys that are also `reasoning.*` settings (`effort`, `enabled`, …) are handled by those settings and by the dialect selection above; only vendor-specific extras (e.g. OpenRouter's `exclude`) pass through here. |
