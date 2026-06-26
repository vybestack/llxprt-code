# Using Local Models

LLxprt Code provides excellent support for local AI models, allowing you to run powerful language models on your own hardware for enhanced privacy, cost control, and offline capabilities. This guide covers everything you need to know about setting up and optimizing local model usage.

## Overview

Local models offer several advantages:

- **Privacy**: Your code and conversations never leave your machine
- **Cost Control**: No API fees once you have the hardware
- **Offline Capability**: Work without internet connectivity
- **Customization**: Fine-tune models for your specific needs
- **Speed**: Potentially faster responses with dedicated hardware

LLxprt Code supports any OpenAI-compatible local server, including:

- **LM Studio**: User-friendly GUI for running models locally
- **llama.cpp**: Efficient C++ implementation for various models
- **Ollama**: Easy-to-use local model server
- **text-generation-webui**: Advanced web interface for local models
- **Jan**: Open-source ChatGPT alternative
- **LocalAI**: Local OpenAI-compatible API server

## Basic Setup

### 1. Configure Base URL

Use the `/baseurl` command to point to your local server:

```bash
/baseurl http://localhost:1234/v1  # LM Studio default
/baseurl http://localhost:11434/v1 # Ollama default
/baseurl http://localhost:5000/v1  # Common alternative
```

### 2. Remove API Key Requirements

Local servers typically don't require authentication:

```bash
/key clear  # Remove any existing API key
```

If your local server does require authentication, you can still set a key:

```bash
/key your-local-server-key
# or use a keyfile
/keyfile path/to/local-key.txt
```

### 3. Select Your Model

Choose the model name as it appears in your local server:

```bash
/model llama-3.1-70b-instruct
/model codestral-latest
/model qwen2.5-coder-32b
```

## Essential Ephemeral Settings

Local models often require specific configuration for optimal performance. Use these ephemeral settings to fine-tune your experience:

### Context Size Configuration

Match your context limit to your local model's configuration:

```bash
# Common context sizes
/set context-limit 32768    # 32K context (typical for many models)
/set context-limit 131072   # 128K context (larger models)
/set context-limit 1048576  # 1M context (advanced setups)
```

**Important**: This should match the context size configured in your local server (LM Studio, llama.cpp, etc.). Mismatched settings can cause truncation or errors.

### Socket Configuration for Stability

Local AI servers can sometimes have connection stability issues. Configure socket settings for more reliable connections:

```bash
/set socket-timeout 120000      # 2 minute timeout for long responses
/set socket-keepalive true      # Enable TCP keepalive (default)
/set socket-nodelay true        # Disable Nagle algorithm (default)
```

These settings help prevent "socket hang up" and "connection terminated" errors common with local servers.

### Compression Settings

For large contexts, configure when compression kicks in:

```bash
/set compression-threshold 0.8  # Compress when context reaches 80% of limit
```

### Tool Format Configuration

Different models have different tool calling formats. Configure the appropriate format for your model:

```bash
/toolformat openai    # Most local models (default)
/toolformat qwen      # Qwen models and derivatives
/toolformat deepseek  # DeepSeek models
```

#### Tool Format Details

- **OpenAI Format**: Standard function calling format used by most models
- **Qwen Format**: Used by Qwen models and some Chinese models
- **DeepSeek Format**: Specific format for DeepSeek Coder models

If you're unsure, start with `openai` format as it's the most widely supported.

## Popular Local Server Configurations

### LM Studio

LM Studio is one of the easiest ways to run local models:

1. Download and install LM Studio
2. Download your preferred model through the LM Studio interface
3. Start the local server (usually on port 1234)
4. Configure LLxprt Code:

```bash
/baseurl http://localhost:1234/v1
/key clear
/model your-model-name
/set context-limit 32768  # Match LM Studio's context setting
```

### Ollama

Ollama provides a simple command-line interface for local models:

1. Install Ollama
2. Pull a model: `ollama pull llama3.1:70b`
3. Start Ollama (runs on port 11434 by default)
4. Configure LLxprt Code:

```bash
/baseurl http://localhost:11434/v1
/key clear
/model llama3.1:70b
/set context-limit 131072  # Ollama often supports larger contexts
```

### llama.cpp Server

llama.cpp's built-in server (`llama-server`) exposes an OpenAI-compatible API that LLxprt Code can talk to directly. This section walks through the full setup: building/serving a GGUF model, validating the endpoint, saving a reusable profile, and testing it.

#### Build and start the server

For Apple Silicon and other constrained-disk machines, keep both the llama.cpp checkout/build and the model files on an external or data volume (for example `/Volumes/XS1000`) rather than filling up your main drive.

```bash
# Build llama.cpp on the data volume.
mkdir -p /Volumes/XS1000/$USER/tools /Volumes/XS1000/$USER/models
cd /Volumes/XS1000/$USER/tools
git clone https://github.com/ggml-org/llama.cpp.git
cmake -S llama.cpp -B llama.cpp/build -DGGML_METAL=ON -DCMAKE_BUILD_TYPE=Release
cmake --build llama.cpp/build --target llama-server llama-cli
```

If disk space is not a concern, you can install a packaged `llama-server` instead; just keep the GGUF model itself wherever you have enough space.

Download or copy a GGUF model to the data volume, then start the server. Match `-c` (context size) to what you intend to use in LLxprt Code, and set `-ngl` to offload layers to the GPU:

```bash
/Volumes/XS1000/$USER/tools/llama.cpp/build/bin/llama-server \
  -m /Volumes/XS1000/$USER/models/your-model.gguf \
  -c 32768 \
  --host 127.0.0.1 \
  --port 8080 \
  -ngl 99
```

#### Validate the endpoint with curl

Before pointing LLxprt Code at the server, confirm it is responding:

```bash
# List available models
curl --fail -sS http://127.0.0.1:8080/v1/models

# Test a chat completion
curl --fail -sS http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model.gguf",
    "messages": [{"role": "user", "content": "Reply with: ok"}]
  }'
```

The `/v1/models` response reports the model name (often the GGUF filename). LLxprt Code accepts that short name — you do not need to pass the full path as the model.

#### Configure LLxprt Code interactively

```bash
/provider openai
/baseurl http://127.0.0.1:8080/v1
/key clear
/model your-model.gguf
/set context-limit 32768     # Match the -c parameter
/set socket-timeout 300000   # 5 minutes — local inference can be slow
/toolformat openai           # llama.cpp speaks the OpenAI tool format
```

Local servers generally ignore the `Authorization` header, so `/key clear` is sufficient interactively. When persisting settings to a profile (below), a harmless placeholder for `auth-key` avoids falling back to an unrelated `OPENAI_API_KEY`; llama.cpp will not check it.

#### Save a reusable profile

Instead of re-typing the commands above every session, persist them to a profile. Profiles live in `~/.llxprt/profiles/<name>.json` and are loaded with `/profile load <name>` or the `--profile-load` flag.

You can build the profile interactively and run `/profile save <name>`, or hand-write the JSON. For a llama.cpp server, use the `openai` provider (its server is OpenAI-compatible) and these ephemeral settings keys:

| Key              | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `base-url`       | The llama.cpp server's `/v1` endpoint                          |
| `auth-key`       | Placeholder for llama.cpp; prevents ambient API key fallback   |
| `context-limit`  | Must match the server's `-c` value                             |
| `socket-timeout` | Generous timeout (ms) for slow local inference                 |
| `tool-format`    | `openai` for llama.cpp's OpenAI-compatible tool calling format |

> **Note:** The persisted key is `tool-format` (kebab-case), not `toolFormat`.

Example profile (`~/.llxprt/profiles/llamacpp.json`):

```json
{
  "version": 1,
  "provider": "openai",
  "model": "your-model.gguf",
  "modelParams": {},
  "ephemeralSettings": {
    "base-url": "http://127.0.0.1:8080/v1",
    "auth-key": "local-no-key-required",
    "context-limit": 32768,
    "socket-timeout": 300000,
    "tool-format": "openai"
  }
}
```

Load it interactively or at startup:

```bash
/profile load llamacpp         # inside a session
node scripts/start.js --profile-load llamacpp   # from a dev checkout
llxprt --profile-load llamacpp # installed CLI
```

#### Validate the profile non-interactively

Run a one-shot prompt through the profile to confirm the full chain works end to end. Unset `OPENAI_API_KEY` first so LLxprt Code relies on the profile's `auth-key` placeholder rather than any ambient environment key:

```bash
unset OPENAI_API_KEY
node scripts/start.js \
  --profile-load llamacpp \
  "Reply with exactly: llxprt local profile ok"
```

Contributors who need to validate the interactive UI can drive the same profile with `scripts/tmux-harness.js`; see [tmux harness](../dev-docs/tmux-harness.md).

### Using Gemma-family GGUF models

The setup above works with any GGUF model. Gemma-family models (Gemma 2, Gemma 3, Gemma 4, etc.) are a strong choice for local coding assistance and are available in GGUF form from Hugging Face.

#### Choosing a Gemma GGUF

General guidance:

- Pick a quantization that fits your RAM/VRAM. QAT Q4_0 and similar 4-bit quantizations dramatically reduce file size while retaining most quality.
- Store the downloaded GGUF on an external or data volume (e.g. `/Volumes/XS1000`) when your main drive is space-constrained.
- Match the server's `-c` (context) to the model's supported context length — Gemma models can have very large context windows (262,144 tokens for some variants).

#### Tested example: Gemma 4 12B (QAT Q4_0)

The following was validated end to end with LLxprt Code:

- **Model**: `google/gemma-4-12B-it-qat-q4_0-gguf` (public, non-gated on Hugging Face)
- **Main file**: `gemma-4-12b-it-qat-q4_0.gguf` (~6.5 GB)
- **Context length**: 262,144 tokens
- **Hardware**: Fit comfortably in QAT Q4_0 form on an Apple MBP M4 Max with 128 GB RAM

Start the server. The example below uses a practical 32K runtime context even though the model advertises a larger maximum; increase `-c` and the profile's `context-limit` together if your hardware can support it.

```bash
/Volumes/XS1000/$USER/tools/llama.cpp/build/bin/llama-server \
  -m /Volumes/XS1000/$USER/models/gemma-4/gemma-4-12b-it-qat-q4_0.gguf \
  -c 32768 \
  --host 127.0.0.1 \
  --port 8080 \
  -ngl 99
```

The short model name `gemma-4-12b-it-qat-q4_0.gguf` was accepted directly by both `curl /v1/chat/completions` and by LLxprt Code's profile `model` field.

Save a profile for it (`~/.llxprt/profiles/gemma4-llamacpp.json`):

```json
{
  "version": 1,
  "provider": "openai",
  "model": "gemma-4-12b-it-qat-q4_0.gguf",
  "modelParams": {},
  "ephemeralSettings": {
    "base-url": "http://127.0.0.1:8080/v1",
    "auth-key": "local-no-key-required",
    "context-limit": 32768,
    "socket-timeout": 300000,
    "tool-format": "openai"
  }
}
```

Then validate non-interactively:

```bash
env OPENAI_API_KEY= node scripts/start.js \
  --profile-load gemma4-llamacpp \
  "Reply with exactly: llxprt local profile ok"
```

This is just one tested example — other Gemma variants and sizes work with the same steps; adjust the GGUF filename, context length, and `-ngl` to your hardware.

## Performance Optimization

### Hardware Considerations

- **GPU Memory**: More VRAM allows larger models and longer contexts
- **System RAM**: Important for CPU inference and large contexts
- **CPU**: Faster CPUs improve response times for CPU inference

### LLxprt Code Settings

```bash
# Optimize for local performance
/set socket-timeout 300000      # 5 minutes for large model responses
/set compression-threshold 0.9  # Less aggressive compression
/set context-limit 65536        # Balance between capability and speed
```

### Model Selection

Consider these factors when choosing models:

- **Size vs Speed**: Smaller models (7B-13B) are faster but less capable
- **Quantization**: Q4_K_M provides good balance of size and quality
- **Specialization**: Code-specific models like CodeLlama or Qwen2.5-Coder

## Saving Your Configuration

Once you have your local setup working, save it as a profile:

```bash
/profile save local-dev
```

Load it anytime with:

```bash
/profile load local-dev
```

## Troubleshooting

### Common Issues

1. **Connection Refused**
   - Ensure your local server is running
   - Check the port number in your `/baseurl`
   - Verify firewall settings

2. **Socket Hang Up Errors**
   - Increase socket timeout: `/set socket-timeout 180000`
   - Enable keepalive: `/set socket-keepalive true`

3. **Tool Calling Errors**
   - Try different tool formats: `/toolformat qwen` or `/toolformat openai`
   - Some models don't support tools - check model documentation

4. **Context Overflow**
   - Reduce context limit: `/set context-limit 16384`
   - Enable compression: `/set compression-threshold 0.7`

5. **Slow Responses**
   - Use smaller/faster models
   - Increase socket timeout
   - Check GPU/CPU utilization

### Debug Information

Enable debug logging to troubleshoot issues:

```bash
DEBUG=llxprt:providers:openai llxprt
```

This shows detailed information about API calls and socket configuration.

## Security Considerations

- Local models keep your data private, but ensure your local server is properly secured
- Don't expose local servers to the internet without proper authentication
- Be cautious with file system access when using local models

## Example Complete Setup

Here's a complete example for a local Qwen2.5-Coder setup:

```bash
# Basic configuration
/baseurl http://localhost:1234/v1
/key clear
/model qwen2.5-coder-32b-instruct

# Optimize for local use
/set context-limit 131072
/set socket-timeout 180000
/set socket-keepalive true
/set compression-threshold 0.8
/toolformat qwen

# Save configuration
/profile save qwen-local

# Test the setup
What's the weather like? # Should get a response from your local model
```

This configuration provides a robust setup for local AI development with proper socket handling, context management, and tool support.

## Why These Settings Matter

### Socket Configuration

Local AI servers often run on different networking stacks than cloud APIs. The socket configuration helps by:

- **socket-timeout**: Prevents premature timeouts during long model inference
- **socket-keepalive**: Maintains connection during idle periods
- **socket-nodelay**: Reduces latency by disabling packet batching

### Context Management

Unlike cloud APIs with strict token limits, local models let you configure context size. Proper configuration ensures:

- Efficient memory usage
- Consistent behavior across sessions
- Optimal performance for your hardware

### Tool Format Selection

Different model families use different tool calling conventions. Proper format selection ensures:

- Reliable function calling
- Consistent tool execution
- Compatibility with your chosen model

With these configurations, LLxprt Code provides enterprise-grade local AI capabilities while maintaining the familiar interface and powerful tooling you expect.
