# Provider Quick Reference

This guide provides concise setup instructions for common LLM providers. For complete documentation, see the [full provider guide](./providers.md).

## OpenAI

Set up OpenAI models including o3, o1, GPT-4.1, and GPT-4o:

```bash
/provider openai
/key sk-your-openai-key
/model o3-mini
```

**Common models:** `o3-mini`, `o1-preview`, `gpt-4o`, `gpt-4.1`

**Environment variable:** `export OPENAI_API_KEY=sk-...`

## Anthropic (Claude)

Access Claude models through API key or OAuth:

### API Key Setup

```bash
/provider anthropic
/key sk-ant-your-key
/model claude-sonnet-4-20250115
```

### OAuth (Claude Pro/Max)

```bash
/provider anthropic
/auth
```

**Common models:** `claude-sonnet-4-20250115`, `claude-opus-4`, `claude-sonnet-3.5`

**Environment variable:** `export ANTHROPIC_API_KEY=sk-ant-...`

## Google Gemini

Use Google's Gemini models:

### API Key

```bash
/provider gemini
/key your-gemini-key
/model gemini-2.0-flash
```

### OAuth

```bash
/provider gemini
/auth
```

**Common models:** `gemini-2.0-flash`, `gemini-pro`

**Environment variable:** `export GEMINI_API_KEY=...`

## xAI (Grok)

Access Grok models:

```bash
/provider openai
/baseurl https://api.x.ai/v1/
/key your-xai-key
/model grok-3
```

## OpenRouter

Access 100+ models through OpenRouter:

```bash
/provider openai
/baseurl https://openrouter.ai/api/v1/
/key your-openrouter-key
/model qwen/qwen3-coder
```

## Fireworks

Fast inference with open models:

```bash
/provider openai
/baseurl https://api.fireworks.ai/inference/v1/
/key your-fireworks-key
/model accounts/fireworks/models/llama-v3p3-70b-instruct
```

## Qwen

Access Qwen models for free:

### OAuth (Free)

```bash
/auth qwen enable
```

### API Key

```bash
/provider qwen
/key your-qwen-key
/model qwen3-coder-pro
```

## Cerebras

Powerful qwen-3-coder-480b model:

```bash
/provider openai
/baseurl https://api.cerebras.ai/v1/
/key your-cerebras-key
/model qwen-3-coder-480b
```

## Local Models

Run models locally for privacy:

### LM Studio

```bash
/provider openai
/baseurl http://127.0.0.1:1234/v1/
/model your-local-model
```

### llama.cpp

```bash
/provider openai
/baseurl http://localhost:8080/v1/
/model your-model
```

## Provider Management Commands

- `/provider` - List or switch providers
- `/model` - List or switch models
- `/baseurl` - Set custom API endpoint
- `/key` - Set API key for current session
- `/keyfile` - Load key from file
- `/auth` - OAuth authentication
- `/profile save` - Save provider configuration

** See [providers.md](./providers.md) for complete documentation**
