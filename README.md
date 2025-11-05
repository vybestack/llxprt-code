# LLxprt Code

[![LLxprt Code CI](https://github.com/vybestack/llxprt-code/actions/workflows/ci.yml/badge.svg)](https://github.com/vybestack/llxprt-code/actions/workflows/ci.yml)
&nbsp;[![Mentioned in Awesome Gemini CLI](https://awesome.re/mentioned-badge.svg)](https://github.com/Piebald-AI/awesome-gemini-cli)&nbsp;[![Discord Server](https://dcbadge.limes.pink/api/server/https://discord.gg/Wc6dZqWWYv?style=flat)](https://discord.gg/Wc6dZqWWYv)

![LLxprt Code Screenshot](./docs/assets/llxprt-screenshot.png)

**AI-powered coding assistant that works with any LLM provider.** Command-line interface for querying and editing codebases, generating applications, and automating development workflows.

## Free & Subscription Options

Get started immediately with powerful LLM options:

```bash
# Free Gemini models
/auth gemini enable
/provider gemini
/model gemini-2.5-flash

# Free Qwen models
/auth qwen enable
/provider qwen
/model qwen-3-coder

# Your Claude Pro / Max subscription
/auth anthropic enable
/provider anthropic
/model claude-sonnet-4-5
```

## Why Choose LLxprt Code?

- **Free Tier Support**: Start coding immediately with Gemini, Qwen, or your existing Claude account
- **Provider Flexibility**: Switch between any Anthropic, Gemini, or OpenAI-compatible provider
- **Top Open Models**: Works seamlessly with GLM 4.6, MiniMax-2, and Qwen 3 Coder
- **Local Models**: Run models locally with LM Studio, llama.cpp for complete privacy
- **Privacy First**: No telemetry by default, local processing available
- **Subagent Flexibility**: Create agents with different models, providers, or settings
- **[ACTION] Real-time**: Interactive REPL with beautiful themes
- **Zed Integration**: Native Zed editor integration for seamless workflow

```bash
# Install and get started
npm install -g @vybestack/llxprt-code
llxprt

# Try without installing
npx @vybestack/llxprt-code --provider synthetic --model hf:zai-org/GLM-4.6 --keyfile ~/.synthetic_key "simplify the README.md"
```

## What is LLxprt Code?

LLxprt Code is a command-line AI assistant designed for developers who want powerful LLM capabilities without leaving their terminal. Unlike GitHub Copilot or ChatGPT, LLxprt Code works with **any provider** and can run **locally** for complete privacy.

**Key differences:**

- **Open source & community driven**: Not locked into proprietary ecosystems
- **Provider agnostic**: Not locked into one AI service
- **Local-first**: Run entirely offline if needed
- **Developer-centric**: Built specifically for coding workflows
- **Terminal native**: Designed for CLI workflows, not web interfaces

## Quick Start

1. **Prerequisites:** Node.js 20+ installed
2. **Install:**
   ```bash
   npm install -g @vybestack/llxprt-code
   # Or try without installing:
   npx @vybestack/llxprt-code
   ```
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

- **Free & Subscription Options** - Gemini, Qwen (free), Claude Pro/Max (subscription)
- **Extensive Provider Support** - Any Anthropic, Gemini, or OpenAI-compatible provider [**Provider Guide →**](./docs/providers/quick-reference.md)
- **Top Open Models** - GLM 4.6, MiniMax-2, Qwen 3 Coder
- **Local Model Support** - LM Studio, llama.cpp, Ollama for complete privacy
- **Profile System** - Save provider configurations and model settings
- **Advanced Subagents** - Isolated AI assistants with different models/providers
- **MCP Integration** - Connect to external tools and services
- **Beautiful Terminal UI** - Multiple themes with syntax highlighting

## Interactive vs Non-Interactive Workflows

**Interactive Mode (REPL):**
Perfect for exploration, rapid prototyping, and iterative development:

```bash
# Start interactive session
llxprt

> Explore this codebase and suggest improvements
> Create a REST API endpoint with tests
> Debug this authentication issue
> Optimize this database query
```

**Non-Interactive Mode:**
Ideal for automation, CI/CD, and scripted workflows:

```bash
# Single command with immediate response
llxprt --profile-load zai-glm46 "Refactor this function for better readability"
llxprt "Generate unit tests for payment module" > tests/payment.test.js
```

## Top Open Weight Models

LLxprt Code works seamlessly with the best open-weight models:

### GLM 4.6

- **Context Window**: 200,000 tokens
- **Architecture**: Mixture-of-Experts with 355B total parameters (32B active)
- **Strengths**: Coding, multi-step planning, tool integration
- **15% fewer tokens** for equivalent tasks vs previous generation

### MiniMax-2

- **Context Window**: ~204,800 tokens
- **Architecture**: MoE with 230B total parameters (10B active)
- **Strengths**: Coding workflows, multi-step agents, tool calling
- **Cost**: Only 8% of Claude Sonnet, ~2x faster

### Qwen 3 Coder

- **Context Window**: 256,000 tokens (extendable to 1M)
- **Architecture**: MoE with 480B total parameters (35B active)
- **Strengths**: Agentic coding, browser automation, tool usage
- **Performance**: State-of-the-art on SWE-bench Verified (69.6%)

## Local Models

Run models completely offline for maximum privacy:

```bash
# With LM Studio
/provider openai
/baseurl http://localhost:1234/v1/
/model your-local-model

# With Ollama
/provider ollama
/model codellama:13b
```

Supported local providers:

- **LM Studio**: Easy Windows/Mac/Linux setup
- **llama.cpp**: Maximum performance and control
- **Ollama**: Simple model management
- **Any OpenAI-compatible API**: Full flexibility

## Advanced Subagents

Create specialized AI assistants with isolated contexts and different configurations:

```bash
# Subagents run with custom profiles and tool access
# Access via the commands interface
/subagent list
/subagent create <name>
```

Each subagent can be configured with:

- **Different providers** (Gemini vs Anthropic vs Qwen vs Local)
- **Different models** (Flash vs Sonnet vs GLM 4.6 vs Custom)
- **Different tool access** (Restrict or allow specific tools)
- **Different settings** (Temperature, timeouts, max turns)
- **Isolated runtime context** (No memory or state crossover)

Subagents are designed for:

- **Specialized tasks** (Code review, debugging, documentation)
- **Different expertise areas** (Frontend vs Backend vs DevOps)
- **Tool-limited environments** (Read-only analysis vs Full development)
- **Experimental configurations** (Testing new models or settings)

**[Full Subagent Documentation →](./docs/subagents.md)**

## Zed Integration

Native Zed editor support for seamless development workflow:

```bash
# Install Zed extension
zed:install llxprt-code

# Use within Zed
# (See docs for Zed integration setup)
```

Features:

- **In-editor chat**: Direct AI interaction without leaving Zed
- **Code selection**: Ask about specific code selections
- **Inline suggestions**: Get AI help while typing
- **Project awareness**: Full context of your open workspace

** [Zed Integration Guide →](./docs/zed-integration.md)**

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
