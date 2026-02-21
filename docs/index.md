# LLxprt Code

LLxprt Code is an autonomous AI coding CLI that supports multi-pass development workflows. It works with any major LLM provider — Anthropic, OpenAI, Google Gemini, or local models — using your own subscriptions. No telemetry, no lock-in, fully open source under Apache 2.0.

## Quick Start

```bash
npm install -g @vybestack/llxprt-code
llxprt
```

Once inside the REPL, authenticate with a provider and start coding:

```text
/auth gemini enable
/provider gemini
/model gemini-2.5-flash
```

Or use an API key with an open-weight model provider:

```text
/key save synthetic syn****************b6
/provider Synthetic
/key load synthetic
/model hf:zai-org/GLM-4.7
```

For a full walkthrough including other providers, see the **[Getting Started Guide](./getting-started.md)**.

## What You Can Do

### Use Any Provider

Configure Claude, GPT, Gemini, or local models. Switch providers mid-session, set up multi-account failover, or load balance across API keys.

Recent open-weight models like DeepSeek, Kimi, Minimax, GLM, and Qwen are available through providers such as Z.ai, Synthetic, Chutes, Kimi.com, and Deepseek.ai.

- [Provider Configuration](./cli/providers.md)
- [Authentication](./cli/authentication.md)
- [Local Models](./local-models.md)

### Multi-Pass Development

LLxprt Code plans, implements, tests, debugs, and iterates — across hours, not minutes. Delegate complex tasks to specialized subagents that run autonomously.

- [Getting Started Guide](./getting-started.md)
- [Subagents](./subagents.md)

### Your Subscriptions, Your Control

Use your existing Claude, OpenAI, Google, or Qwen accounts via OAuth. Create profiles for different projects, teams, or workflows. Configure models, temperature, context limits, and more.

- [Profiles](./cli/profiles.md)
- [OAuth Setup](./oauth-setup.md)
- [Configuration](./cli/configuration.md)
- [Prompt Configuration](./prompt-configuration.md)

### Stay Safe

Run commands in sandboxed containers. Configure approval policies to control what the AI can do without asking. Store API keys and auth tokens in your system keyring — the LLM never has access to them. Use `.llxprtignore` to keep sensitive files out of context.

- [Sandboxing](./sandbox.md)

### Extend It

Add capabilities through MCP servers, lifecycle hooks, custom themes, and more.

- [Hooks](./hooks/index.md)
- [MCP Server Integration](./tools/mcp-server.md)
- [Themes](./cli/themes.md)

## Tools

LLxprt Code ships with built-in tools for file editing, shell commands, web search, code analysis, and memory. It also supports [MCP servers](./tools/mcp-server.md) and [extensions](./extension.md) for adding additional tools and capabilities. See the **[Tools Overview](./tools/index.md)** for the full list.

## Reference

- [Ephemeral Settings Reference](./reference/ephemerals.md) — every ephemeral setting with defaults, types, and advice
- [Profile File Reference](./reference/profiles.md) — the profile JSON format, auth config, load balancers, precedence
- [Commands](./cli/commands.md)
- [Configuration](./cli/configuration.md)
- [Keyboard Shortcuts](./keyboard-shortcuts.md)
- [Troubleshooting](./troubleshooting.md)
- [Emoji Filter](./EMOJI-FILTER.md)
- [Context Dumping](./cli/context-dumping.md)

## Contributing

LLxprt Code is open source and community-driven. See the **[Contributing Guide](./CONTRIBUTING.md)** to get started.
