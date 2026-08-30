# Settings and Profiles

LLxprt Code has two kinds of configuration: **persistent settings** (saved to your [user `settings.json`](./reference/application-directories.md)) and **ephemeral settings** (session-only, but saveable to profiles).

## Profiles (Recommended)

Profiles capture your full setup — provider, model, parameters, and ephemeral settings — in one file. Use them instead of passing flags every time.

```
/provider openai
/model hf:moonshotai/Kimi-K3
/baseurl https://api.synthetic.new/openai/v1
/set reasoning.enabled true
/profile save kimi-k3
```

Load it later:

```
/profile load kimi-k3
```

Or at startup:

```bash
llxprt --profile-load kimi-k3
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

Profiles are stored in `<config>/profiles/<name>.json` (see [Application Directories](./reference/application-directories.md)).

### CLI Flags Override Profiles

Command-line flags always win over profile values. This is useful for one-off overrides:

```bash
# Load profile but use a different key
llxprt --profile-load kimi-k3 --key-name synthetic-alt

# Load profile but override the model
llxprt --profile-load kimi-k3 --model gpt-5.5
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

## Settings File Compatibility

Persistent settings files accept both legacy flat keys and the V2 namespaced shape for settings that have moved under a clearer namespace. Existing files continue to work; new writes for mapped UI primitive keys use the V2 path.

```json
{
  "ui": {
    "accessibility": {
      "screenReader": true,
      "enableLoadingPhrases": false
    },
    "checkpointing": {
      "enabled": true
    },
    "fileFiltering": {
      "respectGitIgnore": true,
      "respectLlxprtIgnore": true,
      "enableRecursiveFileSearch": true,
      "enableFuzzySearch": false
    }
  }
}
```

Backward-compatible mappings:

| Legacy path       | V2 path written by settings updates |
| ----------------- | ----------------------------------- |
| `accessibility.*` | `ui.accessibility.*`                |
| `checkpointing.*` | `ui.checkpointing.*`                |
| `fileFiltering.*` | `ui.fileFiltering.*`                |

When both legacy and V2 locations are present in the same settings layer, the V2 value wins. Normal scope precedence still applies across settings files.

This is the complete V2 compatibility mapping currently supported by LLxprt. Other root-level settings remain in their existing locations until they get an explicit namespaced compatibility path.

Model settings have one compatibility exception: the legacy `model` setting is a string and remains supported as-is for model selection. V2 files may also use an object when they need compression settings next to the model name:

```json
{
  "model": {
    "name": "gpt-5.5",
    "compressionThreshold": 0.7
  }
}
```

`compressionThreshold` must be a number from 0 to 1.

`model.name` is normalized back to the active model string, and `model.compressionThreshold` maps to the legacy runtime shape `chatCompression.contextPercentageThreshold`. Existing files using `"model": "gpt-4.1"` and/or `chatCompression.contextPercentageThreshold` continue to work.

Merged runtime settings keep `model` as the active model string for existing callers and also expose the V2 object fields as `modelConfig` for code that needs the full namespaced model configuration.

```json
{
  "chatCompression": {
    "contextPercentageThreshold": 0.7
  }
}
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

Use these settings for models that support thinking or reasoning effort.

| Setting                       | Description                                                   | Default          |
| ----------------------------- | ------------------------------------------------------------- | ---------------- |
| `reasoning.enabled`           | Enable or disable reasoning                                   | `false`          |
| `reasoning.effort`            | Effort (`minimal`, `low`, `medium`, `high`, `xhigh`, `max`)   | provider default |
| `reasoning.effortWireFormat`  | Select the provider request shape for effort                  | `auto`           |
| `reasoning.enabledWireFormat` | Select the provider request shape for enablement              | `auto`           |
| `reasoning.effortMap`         | Map generic effort values to model values or numeric budgets  | no map           |
| `reasoning.enabledMap`        | Map generic booleans to provider values                       | no map           |
| `reasoning.includeInResponse` | Show thinking blocks in the terminal                          | `true`           |
| `reasoning.includeInContext`  | Keep thinking in conversation history sent to the model       | `true`           |
| `reasoning.stripFromContext`  | Prune thinking from older turns (`none`, `all`, `allButLast`) | `none`           |
| `reasoning.adaptiveThinking`  | Let a supported provider choose a thinking budget             | `false`          |

#### Run a local server that accepts `reasoning_effort`

Save a profile like this when a custom OpenAI-compatible Chat server accepts a
top-level `reasoning_effort` field:

```json
{
  "version": 1,
  "provider": "openai",
  "model": "local-reasoning-model",
  "modelParams": {},
  "ephemeralSettings": {
    "base-url": "http://127.0.0.1:8000/v1",
    "requires-auth": false,
    "responses-mode": "chat",
    "reasoning.enabled": true,
    "reasoning.effort": "high",
    "reasoning.effortWireFormat": "openai"
  }
}
```

Load the profile with `llxprt --profile-load <name>`. The resulting Chat request
contains `"reasoning_effort": "high"`. For a server whose chat template reads
kwargs instead, use `template-kwargs`; see the
[vLLM profile example](./providers/reasoning-wire-formats.md#vllm-chat_template_kwargs).

The four wire settings resolve independently in this order, highest precedence
first: explicit profile or session value, last matched model default, provider
alias default, then `auto` for selectors or no map for maps. Later matching
model rules win.

Maps replace as a whole. A profile map does not inherit entries from an alias or
matched model map. Missing keys in a string-valued `reasoning.effortMap` use the
generic effort unchanged. For example, a map containing only
`{ "minimal": "low" }` still sends `high` unchanged when the generic effort is
`high`.

`reasoning.budgetTokens` is a direct Anthropic budget. Generic effort does not
automatically produce a token budget because no universal conversion exists.
To derive a budget from effort, select `anthropic-budget` and provide an explicit
numeric effort map.

See [Reasoning Wire Formats](./providers/reasoning-wire-formats.md) for all
selector values, request shapes, warnings, model restrictions, and profile
examples.

`reasoning.includeInResponse` controls terminal display.
`reasoning.includeInContext` controls whether thinking remains available on the
next turn. `reasoning.stripFromContext` controls how older thinking is pruned as
the conversation grows.

### Context and Output Limits

These settings control how much information flows between you, the model, and the tools. Getting them right is the difference between a model that works efficiently and one that drowns in its own output.

| Setting                 | Description                                                          | Default       |
| ----------------------- | -------------------------------------------------------------------- | ------------- |
| `context-limit`         | Max tokens the model can see (system prompt + history + tool output) | model default |
| `max-prompt-tokens`     | Hard ceiling on any single prompt sent to the API                    | `200000`      |
| `compression-threshold` | Fraction of context-limit that triggers compression (0.0–1.0)        | model default |

**How they interact:** The model's context window has a fixed size (e.g., 200K for Claude Opus, 1M for Kimi K3). `context-limit` caps how much of that window you actually use — set it lower than the model's max if you want to leave headroom. Note that the available window can differ by auth variant (API key vs OAuth/subscription). When the conversation history exceeds `compression-threshold × context-limit`, LLxprt compresses older turns to free space. `max-prompt-tokens` is a safety net that prevents any single API call from exceeding a hard limit.

`maxOutputTokens` (set via `/set modelparam maxOutputTokens` or `max_tokens` depending on provider) controls how many tokens the model can generate in a single response. This interacts with context-limit because every token the model generates gets added to the history for the next turn. A model that generates very long responses fills up the context faster, triggering more frequent compressions.

### Tool Output Limits

These prevent a single tool call from flooding the context. This matters more than you might expect — a grep across a large codebase can easily return hundreds of thousands of tokens, which consumes the entire context window in one shot.

| Setting                       | Description                     | Default          |
| ----------------------------- | ------------------------------- | ---------------- |
| `tool-output-max-items`       | Max files/matches per tool call | `50`             |
| `tool-output-max-tokens`      | Max tokens in tool output       | `50000`          |
| `tool-output-item-size-limit` | Max bytes per file/item         | `524288` (512KB) |
| `tool-output-truncate-mode`   | `warn`, `truncate`, or `sample` | `warn`           |

**How they interact:** Every tool result goes into the conversation history. If `tool-output-max-tokens` is 50K and the model makes 3 tool calls in a row, that's potentially 150K tokens of tool output added to context — which on a 200K model means rapid compression (and loss of earlier context). Lowering these limits forces the model to be more surgical with its queries, which often produces better results anyway.

`tool-output-truncate-mode` controls what happens when a tool exceeds its limits. `warn` drops the output entirely and tells the model the results were too large — the model gets nothing back, just a message suggesting it narrow its query. `truncate` cuts the output to fit and silently includes what fits. `sample` picks evenly-spaced lines from the output to give a representative cross-section. `warn` is the default because it forces the model to be more surgical, which usually produces better results than shoveling truncated output into context.

### Shell output acquisition

| Setting                            | Description                                                                                                         | Default   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------- |
| `shell-output-retention-max-bytes` | Shell bytes retained in memory while a command runs; excess is represented by bounded head/tail output and metadata | `4194304` |

This byte budget is enforced while output is acquired, before the separate model-facing token limiter. Commands continue to drain and complete after the budget fills. For PTY commands, the same budget also constrains in-memory terminal display scrollback when its byte-derived line limit is lower than `ptyScrollbackLimit`. Values are clamped to a minimum of 1024 bytes and a hard maximum of 64 MiB; `-1` selects that finite hard maximum rather than disabling the bound.

### Timeouts

| Setting                         | Description                                                 | Default         |
| ------------------------------- | ----------------------------------------------------------- | --------------- |
| `shell-default-timeout-seconds` | Default shell command timeout                               | `300` (5 min)   |
| `shell-max-timeout-seconds`     | Ceiling for shell command timeout (set `-1` for no ceiling) | `900` (15 min)  |
| `task-default-timeout-seconds`  | Default subagent task timeout                               | `900` (15 min)  |
| `task-max-timeout-seconds`      | Ceiling for subagent task timeout (set `-1` for no ceiling) | `1800` (30 min) |
| `socket-timeout`                | HTTP request timeout for API calls (ms)                     | —               |

Some models will kick off commands that wait for user interaction (like an interactive installer or a server that doesn't exit) and then hang indefinitely. The timeouts prevent this from blocking your session forever. The `*-max-timeout-seconds` settings are **ceilings only**: they bound a request upward but never override a shorter one, so a model can always ask for a shorter run. A request above the ceiling — including a `-1` "unlimited" request — is clamped to the ceiling and the result tells the model its request was reduced. To remove a ceiling entirely (genuinely unbounded), set the corresponding `*-max-timeout-seconds` to `-1`.

`-1` on a **default** setting (`shell-default-timeout-seconds` / `task-default-timeout-seconds`) means unlimited _by the default_, but it is still subject to the configured maximum — so a default of `-1` resolves to the maximum unless the maximum itself is `-1`. An explicit `timeout_seconds` argument always takes precedence over the configured default. Precedence for a run is: the explicit `timeout_seconds` argument (or the configured default when the argument is omitted), bounded upward by the configured `*-max-timeout-seconds`. If you're running long builds or test suites, increase `shell-max-timeout-seconds`. For subagent-heavy workflows, increase `task-max-timeout-seconds`.

### Prompt and Caching

| Setting               | Description                                             | Default |
| --------------------- | ------------------------------------------------------- | ------- |
| `prompt-caching`      | Provider-side prompt caching (`off`, `5m`, `1h`, `24h`) | `off`   |
| `enable-tool-prompts` | Load tool-specific prompt files                         | `false` |

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
/profile set-default kimi-k3
```

**Use `--set` for one-off tweaks** without modifying your saved profile:

```bash
llxprt --profile-load kimi-k3 --set streaming=disabled
```

## Provider Alias Defaults

Some provider aliases supply model settings in addition to their endpoint and
default model. You can inspect the active values with `/set` and override them
with a profile or session setting.

**Anthropic and Claude Code** enable reasoning for Claude models. Claude Opus 5
uses adaptive thinking, Anthropic effort, and an effort default of `high`.

**Codex** defaults to GPT-5.6 Sol. Sol, Terra, and Luna use the Responses effort
shape. The alias sets effort to `medium`, summary to `auto`, and prompt caching
to `24h`.

**Kimi** uses different reasoning policies for Kimi K3 and Kimi for Coding K2.7.
K3 accepts `low`, `high`, and `max`, so its model map normalizes the generic
ladder. K2.7 coding uses enabled thinking and no effort field.

**OpenRouter** selects its nested `reasoning` object. **Z.AI**, **DeepSeek**, and
**Fireworks** have model-specific defaults only where a documented model and
request shape are known. **Gemini** owns its native `thinkingConfig`.

See the [reasoning alias and model matrix](./providers/reasoning-wire-formats.md#shipped-model-restrictions)
for the exact selectors, maps, and restrictions. Alias defaults are applied
below explicit profile and session values.

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
/profile save kimi-k3-tuned
```

Then you don't have to remember the tweaks — just load the profile.

## Reference Documentation

- [Ephemeral Settings Reference](./reference/ephemerals.md) — complete reference for every ephemeral setting with defaults, types, and advice
- [Profile File Reference](./reference/profiles.md) — the profile JSON format, all fields, auth config, load balancers, precedence rules

## Related

- [Profiles](./cli/profiles.md) — detailed profile management and multi-bucket failover
- [Authentication](./cli/authentication.md) — key management
- [Providers](./cli/providers.md) — provider-specific configuration
