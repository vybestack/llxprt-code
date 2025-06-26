# Phase 19 – Implement Environment Variable API Key Loading (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the loading of API keys from environment variables for each provider, ensuring that environment variables take precedence over `keyfile` but are overridden by direct `/key` command-line arguments.

## Deliverables

- Modified configuration loading logic to check environment variables.

## Checklist (implementer)

- [ ] Update the configuration loading mechanism (e.g., in `ProviderManager` or a dedicated config module) to check for environment variables for API keys.
  - [ ] For OpenAI, check `process.env.OPENAI_API_KEY`.
  - [ ] For Anthropic, check `process.env.ANTHROPIC_API_KEY`.
  - [ ] Ensure the precedence order: `/key` (CLI arg) > Environment Variable > `/keyfile`.
- [ ] Modify the `OpenAIProvider` and `AnthropicProvider` constructors (or their initialization within `ProviderManager`) to receive the API key from this updated configuration source.

## Self-verify

```bash
npm run typecheck
npm run lint
# Manual test: Run the CLI, set environment variables for API keys, then try to interact with models without using /key or /keyfile.
# Verify that the correct API key is used.
```

**STOP. Wait for Phase 19a verification.**
