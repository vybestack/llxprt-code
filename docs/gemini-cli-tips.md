# Tips for Gemini CLI Users

This guide provides helpful tips for users who are migrating from or using both gemini CLI and llxprt.

## Syncing Configurations with Symbolic Links

If you're using both gemini CLI and llxprt, you can keep your configurations in sync using symbolic links. This prevents the need for manual copying or rsync.

### Setup Instructions

```bash
# Link settings file
ln -s ~/.gemini/settings.json ~/.llxprt/settings.json

# Link context file (GEMINI.md/LLXPRT.md)
ln -s ~/.gemini/GEMINI.md ~/.llxprt/LLXPRT.md

# Link environment variables
ln -s ~/.gemini/.env ~/.llxprt/.env
```

### Platform-Specific Examples

#### Termux (Android)

```bash
ln -s /data/data/com.termux/files/home/.gemini/settings.json /data/data/com.termux/files/home/.llxprt/settings.json
ln -s /data/data/com.termux/files/home/.gemini/GEMINI.md /data/data/com.termux/files/home/.llxprt/LLXPRT.md
ln -s /data/data/com.termux/files/home/.gemini/.env /data/data/com.termux/files/home/.llxprt/.env
```

#### macOS/Linux

```bash
ln -s ~/.gemini/settings.json ~/.llxprt/settings.json
ln -s ~/.gemini/GEMINI.md ~/.llxprt/LLXPRT.md
ln -s ~/.gemini/.env ~/.llxprt/.env
```

## Important Compatibility Notes

While the symlink approach works for many use cases, please be aware that llxprt and gemini CLI configurations are not 100% compatible due to the following differences:

### Key Differences

1. **Authentication**
   - llxprt supports multiple auth providers (OAuth, API keys for different providers)
   - Auth configuration structure differs from gemini CLI
   - Use `/auth` command to set up authentication in llxprt

2. **Model Configuration**
   - llxprt uses a profile-based system instead of a single default model
   - Multiple models can be configured and switched between easily
   - Use `/profile save` and `/profile set-default` to manage model profiles

3. **Provider Support**
   - llxprt supports multiple AI providers (OpenAI, Anthropic, Google)
   - Provider-specific settings may not transfer from gemini CLI
   - Each provider has its own configuration options

4. **Settings Structure**
   - Some settings have different names or structures
   - New settings in llxprt that don't exist in gemini CLI
   - Provider-specific tool format overrides

### Testing Your Setup

After creating the symbolic links, test the configuration:

1. Start llxprt and check if your settings loaded correctly
2. Test authentication with `/auth status`
3. Check your model profiles with `/profile list`
4. If you encounter issues, you may need to:
   - Set up authentication again using `/auth`
   - Create new model profiles using `/profile save`

### When to Use Separate Configurations

Consider maintaining separate configurations if you:

- Use different models or providers in each tool
- Need different authentication methods
- Have customized settings specific to each tool
- Experience conflicts with the shared configuration

## Migration Tips

If you're migrating from gemini CLI to llxprt:

1. **Start Fresh** (Recommended)
   - Run llxprt without symlinks first
   - Set up authentication: `/auth`
   - Configure your preferred model: `/model <model-name>`
   - Save as default profile: `/profile save default` and `/profile set-default default`

2. **Gradual Migration**
   - Start with symlinking only `.env` for API keys
   - Manually configure llxprt-specific settings
   - Test thoroughly before symlinking other files

3. **Check MCP Servers**
   - MCP server configurations should work if paths are correct
   - You may need to update paths if they're absolute and platform-specific

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Remove the symlinked settings.json
   - Run `/auth` to set up authentication properly for llxprt
   - Save your configuration

2. **Model Not Found**
   - llxprt may not recognize gemini CLI's default model setting
   - Use `/model` to see available models
   - Set your preferred model and save a profile

3. **MCP Server Errors**
   - Check that MCP server paths exist and are executable
   - Update paths in settings if needed
   - Some MCP servers may need to be reinstalled for llxprt

### Getting Help

- Check the [llxprt documentation](./index.md)
- Report issues on [GitHub](https://github.com/acoliver/llxprt-code/issues)
- See the [CLI commands reference](./cli/commands.md) for all available commands
