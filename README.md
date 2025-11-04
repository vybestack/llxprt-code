# LLxprt Code

[![LLxprt Code CI](https://github.com/vybestack/llxprt-code/actions/workflows/ci.yml/badge.svg)](https://github.com/vybestack/llxprt-code/actions/workflows/ci.yml)

 
[![Mentioned in Awesome Gemini CLI](https://awesome.re/mentioned-badge.svg)](https://github.com/Piebald-AI/awesome-gemini-cli)

 
[![Discord Server](https://dcbadge.limes.pink/api/server/https://discord.gg/Wc6dZqWWYv?style=flat)](https://discord.gg/Wc6dZqWWYv)

![LLxprt Code Screenshot](./docs/assets/llxprt-screenshot.png)

**AI-powered coding assistant that works with any LLM provider.** Command-line interface for querying and editing codebases, generating applications, and automating development workflows.

- ** Provider Flexibility**: Switch between OpenAI, Anthropic, Google, and 20+ providers instantly
- ** Local Models**: Run models locally with LM Studio, llama.cpp for privacy
- ** Privacy First**: No telemetry by default, local processing available
- **[ACTION] Real-time**: Interactive REPL with beautiful themes
- ** Full Featured**: Advanced profiles, subagents, and MCP server integration

```bash
# Install and get started
npm install -g @vybestack/llxprt-code
llxprt
```

## What is LLxprt Code?

LLxprt Code is a command-line AI assistant designed for developers who want powerful LLM capabilities without leaving their terminal. Unlike GitHub Copilot or ChatGPT, LLxprt Code works with **any provider** and can run **locally** for complete privacy.

**Key differences:**

- **Provider agnostic**: Not locked into one AI service
- **Local-first**: Run entirely offline if needed
- **Developer-centric**: Built specifically for coding workflows
- **Terminal native**: Designed for CLI workflows, not web interfaces

## Quick Start

1. **Prerequisites:** Node.js 20+ installed
2. **Install:** `npm install -g @vybestack/llxprt-code`
3. **Run:** `llxprt`
4. **Choose provider:** Use `/provider` to select your preferred LLM service
5. **Start coding:** Ask questions, generate code, or analyze projects

**First session example:**

```bash
cd your-project/
llxprt
> Explain the architecture of this codebase and suggest improvements
> Create a test file for the user authentication module
> Help me debug this error: [paste error message]
```

## Key Features

| Feature              | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| ** Multi-Provider**  | OpenAI, Anthropic, Google, xAI, OpenRouter, Fireworks, local models |
| ** Local Support**   | LM Studio, llama.cpp, Ollama - keep your code private               |
| ** Profiles**        | Save provider configurations and model settings for reuse           |
| ** Subagents**       | Specialized AI assistants with isolated contexts                    |
| ** MCP Integration** | Connect to external tools and services                              |
| ** Beautiful UI**    | Multiple themes with syntax highlighting                            |

## Popular Use Cases

**Explore and understand codebases:**

```bash
> What's the main architecture of this project?
> How does authentication work here?
> Create documentation for the API endpoints
```

**Generate and modify code:**

```bash
> Create a REST API endpoint for user management
> Add unit tests for the payment processing module
> Refactor this function to be more readable
```

**Debug and troubleshoot:**

```bash
> Why is this API endpoint returning 500 errors?
> Help me optimize this slow database query
> Explain this error and suggest fixes
```

## Provider Quick Start

Choose your AI provider - each option is just one command away:

### OpenAI

```bash
/provider openai
/key sk-your-openai-key
/model o3-mini
```

### Anthropic (Claude)

```bash
/provider anthropic
/key sk-ant-your-key
/model claude-sonnet-4-20250115
```

### Local Models (Private)

```bash
/provider openai
/baseurl http://localhost:1234/v1/
/model your-local-model
```

** [Complete Provider Guide →](./docs/cli/providers.md)**

## Advanced Features

- **Settings & Profiles**: Fine-tune model parameters and save configurations
- **Subagents**: Create specialized assistants for different tasks
- **MCP Servers**: Connect external tools and data sources
- **Checkpointing**: Save and resume complex conversations
- **IDE Integration**: Connect to VS Code and other editors

** [Full Documentation →](./docs/index.md)**

## Migration & Resources

- **From Gemini CLI**: [Migration Guide](./docs/gemini-cli-tips.md)
- **Local Models Setup**: [Local Models Guide](./docs/local-models.md)
- **Command Reference**: [CLI Commands](./docs/cli/commands.md)
- **Troubleshooting**: [Common Issues](./docs/troubleshooting.md)

## Privacy & Terms

LLxprt Code does not collect telemetry by default. Your data stays with you unless you choose to send it to external AI providers.

When using external services, their respective terms of service apply:

- [OpenAI Terms](https://openai.com/policies/terms-of-use)
- [Anthropic Terms](https://www.anthropic.com/legal/terms)
- [Google Terms](https://policies.google.com/terms)
