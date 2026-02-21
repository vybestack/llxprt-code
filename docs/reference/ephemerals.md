# Ephemeral Settings Reference

Complete reference for all ephemeral settings. Set with `/set <key> <value>` during a session or `--set <key>=<value>` at startup. Ephemeral settings don't persist to `settings.json` — they live only for the current session unless saved to a profile with `/profile save`.

For guidance on tuning these for specific models, see [Settings and Profiles](../settings-and-profiles.md).

## Reasoning

Control extended thinking / chain-of-thought. Most models need `reasoning.enabled true` at minimum; the rest have sensible defaults.

| Setting                       | Type    | Default          | Profile | Description                                                                                                                                                                                       |
| ----------------------------- | ------- | ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reasoning.enabled`           | boolean | `false`          | yes     | Turn on thinking mode. Required for models like Kimi K2-Thinking, Claude with thinking, o3.                                                                                                       |
| `reasoning.effort`            | enum    | provider default | yes     | How hard the model thinks: `minimal`, `low`, `medium`, `high`, `xhigh`. Higher = slower + more tokens but better results. Anthropic Opus defaults to `high`. Codex defaults to `medium`.          |
| `reasoning.maxTokens`         | number  | —                | yes     | Cap the thinking token budget (OpenAI). Limits how much the model can think per turn.                                                                                                             |
| `reasoning.budgetTokens`      | number  | —                | yes     | Anthropic-specific thinking budget. Usually set automatically via `reasoning.effort` or adaptive thinking.                                                                                        |
| `reasoning.adaptiveThinking`  | boolean | `false`          | yes     | Let Anthropic auto-tune the thinking budget based on task complexity. Enabled by default for Claude via the `anthropic` provider alias.                                                           |
| `reasoning.includeInResponse` | boolean | `true`           | yes     | Show thinking blocks in the terminal. Set `false` to get reasoning quality without the visual noise.                                                                                              |
| `reasoning.includeInContext`  | boolean | `true`           | yes     | Keep thinking in conversation history sent to the model. If `false`, the model can't reference its own prior reasoning — hurts multi-step tasks.                                                  |
| `reasoning.stripFromContext`  | enum    | `none`           | yes     | Prune old thinking to manage context growth. `none` = keep all (best quality). `allButLast` = keep only latest thinking (good balance). `all` = discard all thinking from context (saves tokens). |
| `reasoning.format`            | enum    | —                | yes     | API format: `native` or `field`. Leave unset unless you know your provider needs a specific format.                                                                                               |
| `reasoning.summary`           | enum    | —                | yes     | OpenAI Responses API reasoning summary: `auto`, `concise`, `detailed`, `none`. Codex alias defaults to `auto`.                                                                                    |
| `text.verbosity`              | enum    | —                | yes     | OpenAI Responses API text verbosity for thinking output: `low`, `medium`, `high`.                                                                                                                 |

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

## Timeouts

Prevent commands and tasks from hanging indefinitely. In seconds (not milliseconds, despite older docs).

| Setting                            | Type        | Default         | Profile | Description                                                                                                                             |
| ---------------------------------- | ----------- | --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `shell-default-timeout-seconds`    | number      | `300` (5 min)   | yes     | Default timeout for shell commands. The model can request a specific timeout, but this applies when it doesn't.                         |
| `shell-max-timeout-seconds`        | number      | `900` (15 min)  | yes     | Hard ceiling — the model can't request longer than this. Increase for long builds/test suites.                                          |
| `shell-inactivity-timeout-seconds` | number      | — (disabled)    | yes     | Kill commands that produce no output for this long. Resets on each output line. Good for catching commands that hang waiting for input. |
| `task-default-timeout-seconds`     | number      | `900` (15 min)  | yes     | Default timeout for subagent tasks.                                                                                                     |
| `task-max-timeout-seconds`         | number      | `1800` (30 min) | yes     | Hard ceiling for subagent tasks.                                                                                                        |
| `socket-timeout`                   | number (ms) | —               | yes     | HTTP request timeout for API calls, in milliseconds. Useful for slow local models.                                                      |

## Loop Detection

Catch models that get stuck repeating the same action.

| Setting                 | Type    | Default          | Profile | Description                                                                             |
| ----------------------- | ------- | ---------------- | ------- | --------------------------------------------------------------------------------------- |
| `maxTurnsPerPrompt`     | number  | `-1` (unlimited) | yes     | Hard limit on turns per prompt. Set to a positive integer to cap runaway sessions.      |
| `loopDetectionEnabled`  | boolean | `true`           | yes     | Master switch for all loop detection. Disable only if you're sure the model won't loop. |
| `toolCallLoopThreshold` | number  | `50`             | yes     | Consecutive identical tool calls before intervention. `-1` = unlimited.                 |
| `contentLoopThreshold`  | number  | `50`             | yes     | Consecutive identical content chunks before intervention. `-1` = unlimited.             |

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

## Prompt Configuration

| Setting                    | Type    | Default | Profile | Description                                                                                              |
| -------------------------- | ------- | ------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `enable-tool-prompts`      | boolean | `false` | yes     | Load tool-specific prompt files from `~/.llxprt/prompts/tools/`. Adds specialized instructions per tool. |
| `include-folder-structure` | boolean | —       | yes     | Include the workspace folder tree in the system prompt. Helps the model navigate, but costs tokens.      |

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

| Setting       | Type | Default | Profile | Description                                                                                         |
| ------------- | ---- | ------- | ------- | --------------------------------------------------------------------------------------------------- |
| `emojifilter` | enum | `auto`  | yes     | Emoji handling: `allowed`, `auto` (detect terminal support), `warn`, `error`.                       |
| `dumponerror` | enum | —       | yes     | Dump API request body to `~/.llxprt/dumps/` on errors: `enabled` or `disabled`.                     |
| `dumpcontext` | enum | —       | yes     | Context dumping: `now` (dump immediately), `status`, `on` (every turn), `error` (on errors), `off`. |

## Model Parameters

These are passed directly to the provider API as-is. LLxprt doesn't validate them. Set with `/set modelparam <name> <value>`.

| Parameter           | Type     | Description                                                                     |
| ------------------- | -------- | ------------------------------------------------------------------------------- |
| `temperature`       | number   | Sampling temperature (0.0–2.0). Lower = more deterministic.                     |
| `max_tokens`        | number   | Max tokens to generate (OpenAI/Anthropic). Alias: `maxTokens`.                  |
| `max_output_tokens` | number   | Max output tokens (Gemini native param).                                        |
| `top_p`             | number   | Nucleus sampling threshold.                                                     |
| `top_k`             | number   | Top-k sampling.                                                                 |
| `frequency_penalty` | number   | Penalize repeated tokens.                                                       |
| `presence_penalty`  | number   | Penalize tokens that appeared at all.                                           |
| `seed`              | number   | Random seed for deterministic output (OpenAI only).                             |
| `stop`              | string[] | Stop sequences — model stops generating when it produces any of these.          |
| `response_format`   | JSON     | Response format (e.g., `{"type": "json_object"}`).                              |
| `logit_bias`        | JSON     | Per-token bias.                                                                 |
| `reasoning`         | JSON     | OpenAI reasoning config object. Usually set via `reasoning.*` settings instead. |
