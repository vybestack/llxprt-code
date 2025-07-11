# Task: Documentation Updates

## Objective

Update documentation to reflect the multi-provider functionality and ensure all new features are properly documented.

## Files to Create/Modify

### Priority 1 - User Documentation:

1. **`docs/cli/providers.md`** (create if doesn't exist)
   - Document available providers
   - Explain provider switching
   - Show authentication setup
   - Include examples

2. **`docs/cli/configuration.md`** (update)
   - Add provider configuration section
   - Document environment variables
   - Explain config precedence

3. **`README.md`** (update)
   - Add multi-provider mention
   - Update feature list
   - Add quick start for providers

### Priority 2 - API Documentation:

4. **`packages/cli/src/providers/README.md`** (update)
   - Document provider interface
   - Explain architecture
   - Add implementation guide

5. **Provider-specific docs**
   - Update OpenAI provider docs
   - Update Anthropic provider docs
   - Document tool parsing formats

### Priority 3 - Migration Guide:

6. **`docs/migration/multi-provider.md`** (create)
   - Breaking changes
   - Migration steps
   - Troubleshooting

## Specific Documentation Needed

### Provider Usage Guide:

````markdown
## Multi-Provider Support

Gemini CLI now supports multiple AI providers:

### Available Providers

- Google Gemini (default)
- OpenAI (GPT-4, GPT-3.5)
- Anthropic (Claude)

### Switching Providers

```bash
/provider openai
/provider anthropic
/provider gemini
```
````

### Authentication

```bash
# Set API keys via environment
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...

# Or use /auth command
/auth openai sk-...
```

```

### Configuration Documentation:
- How provider settings are stored
- Environment variable names
- Config file format
- Precedence rules

### Tool Parsing Documentation:
- JSON format (default)
- Text-based formats (Hermes, XML, etc.)
- Provider-specific requirements

## Verification Steps
1. All new commands documented
2. Configuration options explained
3. Examples work when tested
4. No references to removed features
5. Migration path clear

## Dependencies
- All P1 tasks must be complete
- Features must be working

## Estimated Time
1 hour

## Notes
- Keep documentation concise but complete
- Include working examples
- Document any limitations
- Consider adding troubleshooting section
```
