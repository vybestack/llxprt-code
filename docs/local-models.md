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

For direct llama.cpp server usage:

1. Build llama.cpp with server support
2. Start server: `./llama-server -m model.gguf -c 32768 --port 8080`
3. Configure LLxprt Code:

```bash
/baseurl http://localhost:8080/v1
/key clear
/model your-model
/set context-limit 32768  # Match the -c parameter
/set socket-timeout 180000  # llama.cpp can be slower
```

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
