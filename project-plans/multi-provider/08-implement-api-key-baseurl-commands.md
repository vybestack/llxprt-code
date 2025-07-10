# Phase 08 – Implement API Key and Base URL Commands (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the `/key`, `/keyfile`, and `/baseurl` commands to allow users to configure API keys and custom base URLs for the active provider. These configurations will be passed to the `OpenAIProvider` instance.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts` to accept configuration for providers.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts` constructor to accept `apiKey` and `baseURL`.
- Modified CLI command parsing to handle `/key`, `/keyfile`, and `/baseurl`.

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/IProvider.ts` to include an optional `config` property in the constructor signature if needed, or ensure `apiKey` and `baseURL` can be passed directly.
- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.ts`:
  - [ ] Modify the constructor to accept `apiKey: string` and `baseURL?: string`.
  - [ ] Use these parameters to initialize the `OpenAI` client.
  - [ ] Ensure the `getModels` and `generateChatCompletion` methods use this configured client.
- [ ] Update `packages/cli/src/providers/ProviderManager.ts`:
  - [ ] Modify the `registerProvider` method or constructor to allow passing configuration (e.g., `apiKey`, `baseURL`) to the provider instances.
  - [ ] When `OpenAIProvider` is instantiated, pass the relevant configuration.
- [ ] Modify the CLI command parsing logic (where `/` commands are handled):
  - [ ] Implement the `/key <api_key>` command:
    - [ ] Store the API key (e.g., in a temporary configuration object or directly update the active provider's config).
    - [ ] Re-initialize the active provider with the new key.
    - [ ] Provide user feedback.
  - [ ] Implement the `/keyfile <path>` command:
    - [ ] Read the API key from the specified file path (handle `~` for home directory).
    - [ ] Store and re-initialize the active provider with the new key.
    - [ ] Provide user feedback.
  - [ ] Implement the `/baseurl <url>` command:
    - [ ] Store the base URL.
    - [ ] Re-initialize the active provider with the new base URL.
    - [ ] Provide user feedback.

## Self-verify

```bash
npm run typecheck
npm run lint
# Manual test: Run the CLI and try commands like /key, /keyfile, /baseurl, then send a message.
# Verify that the API calls are made with the correct credentials and endpoint.
```

**STOP. Wait for Phase 08a verification.**
