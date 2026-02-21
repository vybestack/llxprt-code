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
        "hf:moonshotai/Kimi-K2-Thinking",
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
/model hf:moonshotai/Kimi-K2-Thinking
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

### OAuth Providers (Codex, Gemini, Anthropic, Qwen)

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

## Related

- [Zed External Agents Documentation](https://zed.dev/docs/ai/external-agents)
- [Authentication](./cli/authentication.md) — keyring setup
- [Profiles](./cli/profiles.md) — saving and loading configurations
- [Providers](./cli/providers.md) — provider setup
