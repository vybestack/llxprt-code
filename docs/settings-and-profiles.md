# Settings and Profiles

LLxprt Code has two kinds of configuration: **persistent settings** (saved to `~/.llxprt/settings.json`) and **ephemeral settings** (session-only, but saveable to profiles).

## Profiles (Recommended)

Profiles capture your full setup — provider, model, parameters, and ephemeral settings — in one file. Use them instead of passing flags every time.

```
/provider openai
/model hf:moonshotai/Kimi-K2-Thinking
/baseurl https://api.synthetic.new/openai/v1
/set reasoning.enabled true
/profile save kimi-k2
```

Load it later:

```
/profile load kimi-k2
```

Or at startup:

```bash
llxprt --profile-load kimi-k2
```

### Profile Commands

```
/profile save <name>            # Save current config
/profile load <name>            # Load a profile
/profile list                   # Show saved profiles
/profile delete <name>          # Delete a profile
/profile set-default <name>     # Auto-load on startup
/profile set-default none       # Clear auto-load
```

Profiles are stored in `~/.llxprt/profiles/<name>.json`.

### CLI Flags Override Profiles

Command-line flags always win over profile values. This is useful for one-off overrides:

```bash
# Load profile but use a different key
llxprt --profile-load kimi-k2 --key-name synthetic-alt

# Load profile but override the model
llxprt --profile-load kimi-k2 --model gpt-4.1
```

## Ephemeral Settings

Set with `/set` during a session or `--set` at startup. These don't persist unless saved to a profile.

```
/set context-limit 100000
/set compression-threshold 0.7
```

At startup:

```bash
llxprt --set context-limit=100000 --set streaming=disabled
```

### Core Settings

| Setting                 | Description                                    | Default          |
| ----------------------- | ---------------------------------------------- | ---------------- |
| `context-limit`         | Maximum context window tokens                  | model default    |
| `compression-threshold` | When to compress history (0.0–1.0)             | model default    |
| `max-prompt-tokens`     | Max tokens in any prompt sent to LLM           | `200000`         |
| `streaming`             | `enabled` or `disabled`                        | `enabled`        |
| `base-url`              | Custom API endpoint                            | provider default |
| `shell-replacement`     | Allow `$()` and backtick substitution in shell | `false`          |
| `auth.noBrowser`        | Skip browser for OAuth, use manual code entry  | `false`          |

### Reasoning Settings

These control extended thinking / chain-of-thought for models that support it (Kimi K2-Thinking, Claude with thinking, o3, etc.).

| Setting                       | Description                                                   | Default          |
| ----------------------------- | ------------------------------------------------------------- | ---------------- |
| `reasoning.enabled`           | Enable thinking/reasoning mode                                | `false`          |
| `reasoning.effort`            | Reasoning effort level (`low`, `medium`, `high`)              | provider default |
| `reasoning.includeInResponse` | Show thinking blocks in the terminal                          | `true`           |
| `reasoning.includeInContext`  | Keep thinking in conversation history sent to the model       | `true`           |
| `reasoning.stripFromContext`  | Prune thinking from older turns (`none`, `all`, `allButLast`) | `none`           |
| `reasoning.adaptiveThinking`  | Let provider auto-tune thinking budget                        | `false`          |

When you set `reasoning.enabled true`, the other defaults are already sensible — thinking is shown in the terminal, kept in context, and nothing is stripped. You typically only need `/set reasoning.enabled true`.

**Why these matter:**

- **`includeInResponse`** — if `false`, the model still thinks but you don't see it. Useful if you want reasoning quality without the noise.
- **`includeInContext`** — if `false`, thinking blocks are discarded before the next turn. The model loses access to its own reasoning, which can hurt multi-step tasks. Keep this `true` unless you're tight on context.
- **`stripFromContext`** — controls context growth for long sessions. `none` keeps all thinking (best quality, most tokens). `allButLast` keeps only the most recent thinking block (good balance). `all` strips everything (saves context but the model can't reference prior reasoning). For models with large context windows like K2 (256K), `none` is fine. For smaller windows, `allButLast` or `all` helps.

### Context and Output Limits

These settings control how much information flows between you, the model, and the tools. Getting them right is the difference between a model that works efficiently and one that drowns in its own output.

| Setting                 | Description                                                          | Default       |
| ----------------------- | -------------------------------------------------------------------- | ------------- |
| `context-limit`         | Max tokens the model can see (system prompt + history + tool output) | model default |
| `max-prompt-tokens`     | Hard ceiling on any single prompt sent to the API                    | `200000`      |
| `compression-threshold` | Fraction of context-limit that triggers compression (0.0–1.0)        | model default |

**How they interact:** The model's context window has a fixed size (e.g., 128K for Claude Sonnet, 256K for Kimi K2). `context-limit` caps how much of that window you actually use — set it lower than the model's max if you want to leave headroom. When the conversation history exceeds `compression-threshold × context-limit`, LLxprt compresses older turns to free space. `max-prompt-tokens` is a safety net that prevents any single API call from exceeding a hard limit.

`maxOutputTokens` (set via `/set modelparam maxOutputTokens` or `max_tokens` depending on provider) controls how many tokens the model can generate in a single response. This interacts with context-limit because every token the model generates gets added to the history for the next turn. A model that generates very long responses fills up the context faster, triggering more frequent compressions.

### Tool Output Limits

These prevent a single tool call from flooding the context. This matters more than you might expect — a grep across a large codebase can easily return hundreds of thousands of tokens, which consumes the entire context window in one shot.

| Setting                       | Description                     | Default          |
| ----------------------------- | ------------------------------- | ---------------- |
| `tool-output-max-items`       | Max files/matches per tool call | `50`             |
| `tool-output-max-tokens`      | Max tokens in tool output       | `50000`          |
| `tool-output-item-size-limit` | Max bytes per file/item         | `524288` (512KB) |
| `tool-output-truncate-mode`   | `warn`, `truncate`, or `sample` | `warn`           |

**How they interact:** Every tool result goes into the conversation history. If `tool-output-max-tokens` is 50K and the model makes 3 tool calls in a row, that's potentially 150K tokens of tool output added to context — which on a 128K model means immediate compression (and loss of earlier context). Lowering these limits forces the model to be more surgical with its queries, which often produces better results anyway.

`tool-output-truncate-mode` controls what happens when a tool exceeds its limits. `warn` drops the output entirely and tells the model the results were too large — the model gets nothing back, just a message suggesting it narrow its query. `truncate` cuts the output to fit and silently includes what fits. `sample` picks evenly-spaced lines from the output to give a representative cross-section. `warn` is the default because it forces the model to be more surgical, which usually produces better results than shoveling truncated output into context.

### Timeouts

| Setting                         | Description                             | Default         |
| ------------------------------- | --------------------------------------- | --------------- |
| `shell-default-timeout-seconds` | Default shell command timeout           | `300` (5 min)   |
| `shell-max-timeout-seconds`     | Maximum shell command timeout           | `900` (15 min)  |
| `task-default-timeout-seconds`  | Default subagent task timeout           | `900` (15 min)  |
| `task-max-timeout-seconds`      | Maximum subagent task timeout           | `1800` (30 min) |
| `socket-timeout`                | HTTP request timeout for API calls (ms) | —               |

Some models will kick off commands that wait for user interaction (like an interactive installer or a server that doesn't exit) and then hang indefinitely. The timeouts prevent this from blocking your session forever. If you're running long builds or test suites, increase `shell-max-timeout-seconds`. For subagent-heavy workflows, increase `task-max-timeout-seconds`.

### Prompt and Caching

| Setting                    | Description                                             | Default |
| -------------------------- | ------------------------------------------------------- | ------- |
| `prompt-caching`           | Provider-side prompt caching (`off`, `5m`, `1h`, `24h`) | `off`   |
| `enable-tool-prompts`      | Load tool-specific prompt files                         | `false` |
| `include-folder-structure` | Include folder tree in system prompt                    | `false` |

### Other Settings

| Setting            | Description                                         | Default |
| ------------------ | --------------------------------------------------- | ------- |
| `emojifilter`      | Emoji handling (`auto`, `allowed`, `warn`, `error`) | `auto`  |
| `custom-headers`   | HTTP headers as JSON                                | —       |
| `api-version`      | API version (e.g., for Azure)                       | —       |
| `socket-keepalive` | TCP keepalive for local servers                     | `true`  |
| `socket-nodelay`   | TCP_NODELAY for local servers                       | `true`  |

### Unsetting Values

```
/set unset context-limit
/set unset custom-headers
```

## Model Parameters

Model parameters are passed directly to the provider API. LLxprt doesn't validate them — if you typo a parameter name, you'll get an API error, not a LLxprt error.

```
/set modelparam temperature 0.8
/set modelparam max_tokens 4096
/set modelparam top_p 0.9
```

Parameter names are provider-specific (e.g., `max_tokens` for OpenAI/Anthropic, `maxOutputTokens` for Gemini). Check your provider's API docs.

```
/set modelparam                  # List current params
/set unset modelparam temperature  # Remove one
/set unset modelparam              # Clear all
```

## Ergonomics Tips

**Save profiles for things you use often.** Instead of remembering flags, save a profile and load it. You can have as many as you want.

**Set a default profile** so your preferred setup loads automatically:

```
/profile set-default kimi-k2
```

**Use `--set` for one-off tweaks** without modifying your saved profile:

```bash
llxprt --profile-load kimi-k2 --set streaming=disabled
```

## Provider Alias Defaults

Some provider aliases ship with tuned defaults for their models — you get reasonable settings just by using `/provider <name>` without configuring anything. These are a good starting point; you can override any of them with `/set`.

**Anthropic** — sets `maxOutputTokens` to 40K globally. For Claude models specifically, enables reasoning with adaptive thinking (lets the model decide how much to think). For Claude Opus 4.6, sets `reasoning.effort` to `high`.

**Codex** — sets `context-limit` to 262K, enables 24-hour prompt caching, sets `reasoning.effort` to `medium`, and enables reasoning summaries. Tuned for long coding sessions with OpenAI's Codex models.

**Kimi** — sets `context-limit` to 262K and `max_tokens` to 32K. For Kimi models specifically, enables reasoning with `includeInResponse`, `includeInContext`, and `stripFromContext: none` — full thinking visibility with nothing discarded.

**Gemini, OpenAI, xAI, OpenRouter, Fireworks** — minimal defaults (just endpoint URL and default model). You configure behavior yourself.

When you load a provider alias, its defaults apply first, then any `/set` overrides or profile settings layer on top. You can inspect what a provider alias sets by looking at its config file in the source, or just check your active settings with `/set` after loading a provider.

## Tuning for Your Model

Good model ergonomics require tuning to a model's specific strengths and weaknesses. The alias defaults are a starting point, but with experience you'll find the sweet spots.

**The core tradeoff:** letting the model put more information in the context means fewer round-trips (fewer tool calls, faster completion) — but too much context introduces distractors, can overwhelm the model, and triggers frequent compressions that lose earlier work. Conversely, keeping tool output small means more steps (more tool calls, more turns) which can also go sideways. The goal is finding the balance where the model doesn't hurt itself.

**Models that bite off more than they can chew:** some models will try to read entire directories, run massive greps, or generate very long responses that flood the context. Lower `tool-output-max-tokens` and `tool-output-max-items` to force them to be more targeted. You can also lower `maxOutputTokens` to keep individual responses shorter.

**Models that hang:** some models kick off interactive commands, start servers, or run things that wait for input and never return. Tighter `shell-default-timeout-seconds` helps. If you're using a model prone to this, keep the default timeout short and only bump `shell-max-timeout-seconds` for when you explicitly need long-running commands.

**Compression frequency:** if you notice the model losing track of what it's done or repeating work, it's probably compressing too often. Either increase `context-limit` (if the model supports it), lower tool output limits so less junk enters the context, or set `compression-threshold` higher so compression kicks in later. If the model has a small context window, leaner tool output is usually better than pushing the limits.

**Profile per model:** once you've dialed in good settings for a model, save them:

```
/set tool-output-max-items 30
/set tool-output-max-tokens 30000
/set shell-default-timeout-seconds 120
/profile save kimi-k2-tuned
```

Then you don't have to remember the tweaks — just load the profile.

## Reference Documentation

- [Ephemeral Settings Reference](./reference/ephemerals.md) — complete reference for every ephemeral setting with defaults, types, and advice
- [Profile File Reference](./reference/profiles.md) — the profile JSON format, all fields, auth config, load balancers, precedence rules

## Related

- [Profiles](./cli/profiles.md) — detailed profile management and multi-bucket failover
- [Authentication](./cli/authentication.md) — key management
- [Providers](./cli/providers.md) — provider-specific configuration
