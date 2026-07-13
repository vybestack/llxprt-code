# Zed Editor Integration

LLxprt Code integrates with [Zed](https://zed.dev) as an AI assistant via the Agent Communication Protocol (ACP).

## Prerequisites

- [Zed Editor](https://zed.dev)
- LLxprt Code installed (`npm install -g @vybestack/llxprt-code`)
- An API key saved in your keyring (see [Authentication](./cli/authentication.md))

## Setup

### 1. Find Your LLxprt Path

```bash
which llxprt
```

Common locations: `/opt/homebrew/bin/llxprt` (macOS Homebrew), `/usr/local/bin/llxprt` (Linux).

### 2. Save a Key in Your Keyring

From an interactive LLxprt session:

```
/key save synthetic your-api-key-here
```

### 3. Configure Zed

Open Zed settings (`Cmd+,` on macOS, `Ctrl+,` on Linux) and add an agent server. Use `--key-name` to load your saved key:

```json
{
  "agent_servers": {
    "llxprt": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--provider",
        "openai",
        "--model",
        "hf:moonshotai/Kimi-K2.7-Code",
        "--key-name",
        "synthetic",
        "--baseurl",
        "https://api.synthetic.new/openai/v1",
        "--yolo"
      ]
    }
  }
}
```

That's it. Open Zed's assistant panel and select `llxprt`.

## Using Profiles (Recommended)

Profiles are the cleanest approach — they capture provider, model, key, base URL, and settings in one saved config so your Zed settings stay minimal. Create one in an interactive LLxprt session:

```
/provider openai
/model hf:moonshotai/Kimi-K2.7-Code
/key load synthetic
/set base-url https://api.synthetic.new/openai/v1
/profile save model kimi-k2
```

Then reference it in Zed:

```json
{
  "agent_servers": {
    "llxprt": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": ["--experimental-acp", "--profile-load", "kimi-k2", "--yolo"]
    }
  }
}
```

### OAuth Providers (Codex, Anthropic)

If your profile uses OAuth instead of an API key, you must authenticate **before** launching Zed — the ACP mode can't open a browser for you. Run an interactive LLxprt session first:

```
/auth codex login
```

Complete the browser flow, then save the profile. Zed will use the stored OAuth token going forward. Tokens refresh automatically.

## Multiple Agents

Configure multiple entries to switch between providers in Zed:

```json
{
  "agent_servers": {
    "llxprt-kimi": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": ["--experimental-acp", "--profile-load", "kimi-k2", "--yolo"]
    },
    "llxprt-gemini": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--provider",
        "gemini",
        "--model",
        "gemini-2.5-flash",
        "--key-name",
        "gemini",
        "--yolo"
      ]
    },
    "llxprt-local": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": [
        "--experimental-acp",
        "--provider",
        "openai",
        "--baseurl",
        "http://localhost:11434/v1",
        "--model",
        "qwen2.5-coder:32b",
        "--key",
        "dummy"
      ]
    }
  }
}
```

## Flags Reference

| Flag                    | Description                                  |
| ----------------------- | -------------------------------------------- |
| `--experimental-acp`    | Enable ACP mode (required for Zed)           |
| `--profile-load <name>` | Load a saved profile (recommended)           |
| `--key-name <name>`     | Load a saved key from keyring                |
| `--keyfile <path>`      | Read key from a file (good for CI)           |
| `--key <value>`         | Inline key (avoid — visible in process list) |
| `--provider <name>`     | Provider name                                |
| `--model <name>`        | Model name                                   |
| `--baseurl <url>`       | Custom API base URL                          |
| `--set <key=value>`     | Set ephemeral settings (repeatable)          |
| `--yolo`                | Auto-approve all actions                     |

## Debug Logging

Add `LLXPRT_DEBUG` to the environment if something isn't working:

```json
{
  "agent_servers": {
    "llxprt-debug": {
      "command": "/opt/homebrew/bin/llxprt",
      "args": ["--experimental-acp", "--profile-load", "myprofile", "--yolo"],
      "env": {
        "LLXPRT_DEBUG": "llxprt:*"
      }
    }
  }
}
```

Logs go to `~/.llxprt/debug/`. Only enable when troubleshooting — they get large.

## Troubleshooting

**Agent won't start** — verify the path: `which llxprt`. Use the full absolute path in the `command` field.

**Auth failures** — make sure the key name matches what you saved. Check with `llxprt` then `/key list`. For OAuth providers, authenticate interactively first.

**Agent appears but doesn't respond** — try enabling debug logging. Check that the model name is valid for your provider.

**Profile not found** — list profiles with `llxprt` then `/profile list`. Names are case-sensitive.

## Extension Namespace (`llxprt/`)

LLxprt reserves the `llxprt/` prefix for vendor-specific ACP extension methods and notifications. This namespace is documented for future use; no `llxprt/`-prefixed extension methods are implemented yet.

When a concrete use case arrives (e.g. subagent status, memory operations, debug toggles, provider hints), the method name will be `llxprt/<feature>` and will be advertised here. Clients that do not recognize a `llxprt/` method MUST ignore it per the ACP [extensibility](https://agentclientprotocol.com/protocol/extensibility) rules (`_meta` / extension handling).

## Session Metadata

LLxprt emits ACP `session_info_update` notifications carrying:

- **`title`** — a truncated preview of the first user prompt (derived once, consistent with the on-disk session listing).
- **`updatedAt`** — an ISO 8601 timestamp refreshed after every turn (success, cancel, or error).

This metadata also populates the `listSessions` response so Zed's session sidebar shows descriptive names and freshness without reading the recording files.

When a session has both a durable on-disk recording and live in-memory metadata (e.g. the agent process is still running), `listSessions` merges them: the durable recording's title takes precedence (it is the authoritative first-user-message preview), while `updatedAt` is the newer of the two. A session with no durable recording yet shows the live title and `updatedAt` only.

## Terminal Integration

When the client advertises the `terminal` capability (`terminal: true` in `ClientCapabilities`), LLxprt creates an ACP terminal for each shell tool call via `connection.createTerminal`. This delegates command execution to Zed's native terminal renderer, giving the user live inline output as the command runs.

The terminal is correlated to the originating tool call (by command and working directory) and embedded in the tool call's content as a `terminal` content block. The terminal is released after the tool call completes, and killed and released on cancel or session dispose.

When the terminal capability is absent (or `false`), shell output is captured as text and emitted via the standard `content` content block — the same behavior as non-terminal ACP clients.

## Related

- [Zed External Agents Documentation](https://zed.dev/docs/ai/external-agents)
- [Authentication](./cli/authentication.md) — keyring setup
- [Profiles](./cli/profiles.md) — saving and loading configurations
- [Providers](./cli/providers.md) — provider setup
