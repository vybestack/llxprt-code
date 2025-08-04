# Prompt Configuration System

LLxprt Code uses a flexible and customizable prompt configuration system that allows you to tailor the AI's behavior for different providers, models, and environments. This guide explains how to configure and customize prompts.

## Overview

The prompt configuration system provides:

- **Provider-specific prompts**: Different instructions for Gemini, OpenAI, Anthropic, etc.
- **Model-specific adaptations**: Special handling for models like Flash that need explicit tool usage reminders
- **Environment awareness**: Automatic adaptation based on Git repositories, sandboxes, and IDE integration
- **Tool-specific instructions**: Detailed guidance for each available tool
- **User customization**: Override any prompt with your own versions

## Default Prompt Location

LLxprt Code looks for prompts in the following location:

```
~/.llxprt/prompts/
```

If custom prompts are not found, the system uses built-in defaults that are optimized for each provider and model.

## Directory Structure

The prompt configuration follows a hierarchical structure:

```
~/.llxprt/prompts/
├── core.md                          # Main system prompt
├── compression.md                   # Instructions for context compression
├── providers/
│   ├── gemini/
│   │   ├── core.md                 # Gemini-specific overrides
│   │   └── models/
│   │       └── gemini-2.5-flash/
│   │           └── core.md         # Flash-specific instructions
│   ├── openai/
│   │   └── core.md                 # OpenAI-specific overrides
│   └── anthropic/
│       └── core.md                 # Anthropic-specific overrides
├── env/
│   ├── git-repository.md           # Added when in a Git repo
│   ├── sandbox.md                  # Added when sandboxed
│   ├── macos-seatbelt.md          # macOS sandbox specifics
│   └── ide-mode.md                # IDE integration context
├── tools/
│   ├── edit.md                    # Edit tool instructions
│   ├── shell.md                   # Shell command guidance
│   ├── web-fetch.md              # Web fetching rules
│   └── ...                       # Other tool-specific prompts
└── services/
    ├── loop-detection.md         # Loop detection warnings
    └── init-command.md          # Init command prompts

```

## Prompt Resolution Order

Prompts are resolved in the following order (later overrides earlier):

1. **Built-in defaults**: Core prompts shipped with LLxprt Code
2. **Provider defaults**: Provider-specific adaptations
3. **Model defaults**: Model-specific refinements
4. **User customizations**: Your custom prompts in `~/.llxprt/prompts/`

## Template Variables

Prompts support template variables that are automatically replaced:

- `{{enabledTools}}`: List of available tools
- `{{environment}}`: Current environment details
- `{{provider}}`: Active provider name
- `{{model}}`: Current model name

### Example Template Usage

```markdown
You have access to these tools: {{enabledTools}}

Current environment:
{{environment}}

You are running on {{provider}} with model {{model}}.
```

## Customizing Prompts

### Method 1: Manual Creation

Create your custom prompts in the `~/.llxprt/prompts/` directory:

```bash
# Create the prompts directory
mkdir -p ~/.llxprt/prompts

# Create a custom core prompt
cat > ~/.llxprt/prompts/core.md << 'EOF'
You are a helpful AI assistant specializing in Python development.
Always write clean, well-documented Python code following PEP 8.

{{enabledTools}}
EOF
```

### Method 2: Using the Installer

The prompt configuration system includes an installer that can set up the default structure:

```bash
# Install default prompts (coming soon)
llxprt prompts install

# Install with custom overrides (coming soon)
llxprt prompts install --custom
```

## Environment-Specific Prompts

The system automatically includes environment-specific prompts based on your context:

### Git Repository Context

When working in a Git repository, the system includes `env/git-repository.md`:

```markdown
## Git Repository Guidelines

You are in a Git repository. Please:

- Respect .gitignore patterns
- Be aware of branch protection rules
- Use conventional commit messages
```

### Sandbox Context

When running in sandbox mode, additional safety instructions are included from `env/sandbox.md`.

### IDE Integration

When IDE mode is active, context about open files and cursor position is included from `env/ide-mode.md`.

## Provider-Specific Customization

### Gemini Flash Models

Flash models require explicit reminders about tool usage. Create a custom prompt:

```bash
mkdir -p ~/.llxprt/prompts/providers/gemini/models/gemini-2.5-flash/
cat > ~/.llxprt/prompts/providers/gemini/models/gemini-2.5-flash/core.md << 'EOF'
IMPORTANT: You MUST use the provided tools when appropriate.
Do not try to simulate or pretend tool functionality.
Always use the actual tools for:
- Reading files: Use read_file tool
- Listing directories: Use list_directory tool
- Running commands: Use run_shell_command tool
EOF
```

### OpenAI Models

Customize behavior for OpenAI models:

```bash
mkdir -p ~/.llxprt/prompts/providers/openai/
cat > ~/.llxprt/prompts/providers/openai/core.md << 'EOF'
You are powered by OpenAI. Optimize responses for efficiency
and clarity. Use parallel tool calls when possible.
EOF
```

## Tool-Specific Instructions

Customize instructions for individual tools:

### Shell Command Tool

```bash
cat > ~/.llxprt/prompts/tools/shell.md << 'EOF'
When using shell commands:
- Always use absolute paths
- Check command existence with 'which' first
- Prefer non-interactive commands
- Explain any complex commands before running
EOF
```

### Edit Tool

```bash
cat > ~/.llxprt/prompts/tools/edit.md << 'EOF'
When editing files:
- Preserve existing code style
- Make minimal necessary changes
- Add comments for complex changes
- Verify file exists before editing
EOF
```

## Advanced Configuration

### Compression Prompts

Customize how context compression works:

```bash
cat > ~/.llxprt/prompts/compression.md << 'EOF'
When compressing conversation history:
- Preserve all technical details
- Keep error messages intact
- Summarize repetitive content
- Maintain chronological order
EOF
```

### Loop Detection

Customize loop detection warnings:

```bash
mkdir -p ~/.llxprt/prompts/services/
cat > ~/.llxprt/prompts/services/loop-detection.md << 'EOF'
You appear to be in a loop. Please:
1. Stop and analyze what went wrong
2. Try a different approach
3. Ask the user for clarification if needed
EOF
```

## Environment Variables

Control prompt behavior with environment variables:

```bash
# Use a custom prompts directory
export LLXPRT_PROMPTS_DIR=/path/to/custom/prompts

# Enable debug mode to see prompt resolution
export DEBUG=true
```

## Debugging Prompts

To see which prompts are being loaded:

1. Enable debug mode:

   ```bash
   DEBUG=true llxprt
   ```

2. Check the prompt resolution in the logs

3. Use the memory command to see the final composed prompt:
   ```
   /memory show
   ```

## Best Practices

1. **Start with defaults**: Only customize what you need to change
2. **Test incrementally**: Make small changes and test their effect
3. **Use version control**: Keep your custom prompts in Git
4. **Document changes**: Add comments explaining why you customized
5. **Share with team**: Use project-specific prompt directories

## Examples

### Academic Writing Assistant

```bash
cat > ~/.llxprt/prompts/core.md << 'EOF'
You are an academic writing assistant. Always:
- Use formal academic language
- Cite sources in APA format
- Maintain objective tone
- Check facts before stating them

{{enabledTools}}
EOF
```

### DevOps Specialist

```bash
cat > ~/.llxprt/prompts/core.md << 'EOF'
You are a DevOps specialist. Focus on:
- Infrastructure as code
- Container best practices
- CI/CD optimization
- Security-first approach

When working with shell commands, prefer:
- Docker and Kubernetes commands
- Terraform for infrastructure
- Ansible for configuration

{{enabledTools}}
EOF
```

### Code Reviewer

```bash
cat > ~/.llxprt/prompts/core.md << 'EOF'
You are a thorough code reviewer. Always check for:
- Security vulnerabilities
- Performance issues
- Code smells
- Missing tests
- Documentation gaps

Provide constructive feedback with examples.

{{enabledTools}}
EOF
```

## Troubleshooting

### Prompts Not Loading

1. Check the directory exists:

   ```bash
   ls -la ~/.llxprt/prompts/
   ```

2. Verify file permissions:

   ```bash
   chmod -R 644 ~/.llxprt/prompts/
   ```

3. Enable debug mode to see loading errors:
   ```bash
   DEBUG=true llxprt
   ```

### Template Variables Not Replaced

Ensure you're using the correct syntax:

- Correct: `{{enabledTools}}`
- Wrong: `{enabledTools}` or `{{ enabledTools }}`

### Provider-Specific Prompts Not Working

Check the directory structure matches exactly:

```bash
~/.llxprt/prompts/providers/[provider-name]/core.md
```

Provider names must be lowercase: `gemini`, `openai`, `anthropic`

## Migration from Hardcoded Prompts

If you were previously modifying LLxprt Code's source code to customize prompts, migrate to the new system:

1. Copy your custom prompts to `~/.llxprt/prompts/`
2. Remove any source code modifications
3. Update to the latest LLxprt Code version
4. Test that your customizations still work

## Contributing Prompt Improvements

If you've created prompts that would benefit others:

1. Test thoroughly in various scenarios
2. Document the use case and benefits
3. Submit a pull request to the LLxprt Code repository
4. Consider sharing in the community discussions

## Future Enhancements

Planned improvements to the prompt system:

- **Prompt marketplace**: Share and download community prompts
- **Interactive installer**: GUI for prompt customization
- **A/B testing**: Compare prompt effectiveness
- **Analytics**: Track which prompts work best
- **Hot reload**: Change prompts without restarting

## Related Documentation

- [Configuration Guide](./cli/configuration.md) - General LLxprt Code configuration
- [Memory System](./core/memport.md) - How context and memory work
- [Provider Guide](./cli/providers.md) - Provider-specific features
- [Tool Documentation](./tools/index.md) - Available tools and their usage
