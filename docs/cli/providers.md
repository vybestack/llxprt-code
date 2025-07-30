# Multi-Provider Support

LLxprt Code supports multiple AI providers, allowing you to switch between different AI models and services seamlessly.

## Available Providers

LLxprt Code currently supports the following providers:

- **Google Gemini** (default) - Google's AI models
- **OpenAI** - o3, o1, GPT-4.1, GPT-4o, and other OpenAI models
- **Anthropic** - Claude Opus 4, Claude Sonnet 4, and other Anthropic models

Additionally, LLxprt Code supports any OpenAI-compatible API, including:

- **xAI** - Grok models (grok-3, etc.)
- **OpenRouter** - Access to 100+ models
- **Fireworks** - Fast inference with open models
- **Local Models** - LM Studio, llama.cpp, and other local servers

## Switching Providers

You can switch between providers using the `/provider` command:

```bash
# Switch to OpenAI
/provider openai

# Switch to Anthropic
/provider anthropic

# Switch back to Gemini
/provider gemini
```

The active provider will be displayed in the UI and persists across sessions.

## Authentication

Each provider requires its own API key. You can set these up in several ways:

### Environment Variables

The recommended way is to set environment variables:

```bash
# For OpenAI
export OPENAI_API_KEY=sk-...

# For Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# For Google Gemini (if not using default auth)
export GOOGLE_API_KEY=...
```

### Using the /key Command

You can set API keys directly within the CLI:

```bash
# Set OpenAI API key
/key sk-...

# Set Anthropic API key (after switching provider)
/provider anthropic
/key sk-ant-...

# Or load from a file
/keyfile ~/.keys/openai.txt
```

### Configuration File

API keys can also be stored in the configuration file. See the [configuration documentation](./configuration.md) for details.

## Model Selection

Each provider offers different models. You can select a specific model using the `/model` command:

```bash
# List available models for current provider
/model

# Select a specific model
/model gpt-4.1
/model o3
/model claude-opus-4
```

## Provider-Specific Features

### OpenAI

- Supports o3 (including o3-pro which REQUIRES Responses API), o1, GPT-4.1, GPT-4o, and other OpenAI models
- Tool calling support with JSON format
- Responses API support for advanced models (o3, o1, gpt-4.1)

### Anthropic

- Supports Claude 4 family models (Opus 4, Sonnet 4) and other Anthropic models
- Native tool calling support
- Higher context windows for certain models

### Google Gemini

- Default provider with seamless integration
- Supports Gemini Pro and other Google models
- Native multimodal support

### OpenAI-Compatible Providers

Many providers offer OpenAI-compatible APIs, which can be used by setting the `openai` provider with a custom base URL:

#### xAI (Grok)

To use Grok models:

```bash
# Command line configuration
llxprt --provider openai --baseurl https://api.x.ai/v1/ --model grok-3 --keyfile ~/.mh_key

# Or interactive configuration
/provider openai
/baseurl https://api.x.ai/v1/
/model grok-3
/keyfile ~/.mh_key
```

#### Other OpenAI-Compatible Services

The same pattern works for OpenRouter, Fireworks, and local models. See the README for detailed examples of each.

## Tool Parsing

Different providers may use different formats for tool calling:

- **JSON Format** (default) - Used by OpenAI and Anthropic
- **Text-based Formats** - Some providers support alternative formats like Hermes or XML

The CLI automatically handles format conversion between providers.

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify your API key is correct
   - Check environment variable names
   - Ensure the key has proper permissions

2. **Model Not Found**
   - Use `/model` to list available models
   - Check provider documentation for model names
   - Some models may require special access

3. **Rate Limiting**
   - Each provider has different rate limits
   - Consider switching providers if hitting limits
   - Implement retry logic for production use

### Getting Help

- Use `/help` to see available commands
- Check provider-specific documentation
- Report issues at the GitHub repository

## Examples

### Basic Usage

```bash
# Start with default Gemini provider
llxprt

# Switch to OpenAI
/provider openai

# Select GPT-4.1
/model gpt-4.1

# Have a conversation
Hello! Can you help me with Python?

# Switch to Anthropic for a different perspective
/provider anthropic
/model claude-opus-4

What's the best way to handle async operations in Python?
```

### Using Multiple Providers in a Session

You can switch between providers within a single session to leverage different models' strengths:

```bash
# Use Gemini for general questions
/provider gemini
Explain quantum computing

# Switch to o3 for advanced reasoning
/provider openai
/model o3
Write a Python implementation of Shor's algorithm

# Use Claude Opus 4 for detailed analysis
/provider anthropic
/model claude-opus-4
Analyze the computational complexity of this implementation
```

## Best Practices

1. **Choose the Right Provider**: Different providers excel at different tasks
2. **Manage API Keys Securely**: Use environment variables and never commit keys
3. **Monitor Usage**: Each provider has different pricing models
4. **Handle Errors Gracefully**: Implement proper error handling for API failures
5. **Stay Updated**: Provider capabilities and models change frequently

## Related Documentation

- [Configuration](./configuration.md) - Detailed configuration options
- [Authentication](./authentication.md) - Authentication methods
- [Commands](./commands.md) - Complete command reference
