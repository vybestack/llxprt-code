## Relocate provider & profile composition out of CLI into the engine packages (Parent #1568)

### Summary

The CLI package is currently the **composition root** for provider and profile concerns that are pure engine/domain logic, not UI. This is concern leakage: code that decides *how to build a provider*, *how to apply a profile*, and *how to switch provider/model* lives in `packages/cli` only because `main()` happens to live there — not because it has anything to do with the terminal UI.

This issue moves that composition into the packages whose responsibility it actually is (primarily `packages/providers`, with profile/switch pieces landing in `providers`/`settings`/`core` as appropriate), so that:

1. `packages/cli` becomes a true thin front-end (TUI + slash-command parsing + invoking a public API).
2. A headless consumer (e.g. the `createAgent` factory planned in #1594, or `a2a-server`, or a script) can construct a working agent with a non-Gemini provider **without depending on the CLI**.

This is a **prerequisite** for #1594 (Design and implement core public API). It is explicitly **not** a new package — it fixes the leak using the packages that already exist.

### Why this is needed (the concrete blocker)

While designing #1594 we found that `createAgent({ provider: 'anthropic', model })` cannot be satisfied from `packages/agents` today. Verified facts:

- `core` does **not** construct concrete non-Gemini providers. `createContentGenerator` uses an injected `contentGeneratorFactory` + `providerManager`, and **throws** if a `providerManager` is present without the factory (`packages/core/src/core/contentGenerator.ts`).
- The only package that depends on `@vybestack/llxprt-code-providers` is **`cli`** (verified: present in `cli/package.json`, absent from `core`, `agents`, `a2a-server`).
- `a2a-server` has **zero** provider references — it only works on the default Gemini API-key path.
- The thing that actually builds the `ProviderManager`, registers OpenAI/Anthropic/Qwen/etc., and injects the `contentGeneratorFactory` into `Config` is `packages/cli/src/providers/providerManagerInstance.ts`. It is in the CLI but is **not CLI code** — its only UI reference is a single removable `type HistoryItemWithoutId` import.

So the engine cannot build a provider by name without the CLI. That is the leak.

### Dependency directions (verified — these constrain the target)

    providers ──→ core        (providers already depends on core; the reverse would be a cycle)
    agents    ──→ core        (agents does NOT currently depend on providers)
    providers ──→ auth, settings, tools, storage   (already)
    cli       ──→ core, providers, agents, auth, settings, ...

Key consequences:
- Concrete provider construction can **never** live in `core` (would create `core → providers → core`). Its correct home is **`providers`**, which already has `core`, `auth`, `settings`, and `tools` available.
- `agents` does not yet depend on `providers`. Adding `agents → providers` is safe (no cycle, since `providers` does not depend on `agents`). This edge is what later lets `createAgent` (in `agents`, per #1594) compose a real provider.

### Scope — what moves

The following currently live in `packages/cli` and are domain logic that should move into the engine. Exact destination per file is for the implementer to confirm, but the recommended targets are noted.

Provider composition (recommended target: `packages/providers`):
- `packages/cli/src/providers/providerManagerInstance.ts` (671 lines) — builds ProviderManager, registers providers, injects the content-generator factory into Config.
- `packages/cli/src/providers/aliasProviderFactory.ts` (474 lines)
- `packages/cli/src/providers/providerAliases.ts` (315 lines) and the `aliases/` data
- `packages/cli/src/providers/oauth-provider-registration.ts` (112 lines)
- `packages/cli/src/providers/providerConfigUtils.ts`, `credentialPrecedence.ts`, `types.ts` as needed by the above.

Profile / runtime-switch pipeline (recommended target: `packages/providers` for provider-switch mechanics, `packages/settings` for profile data/shape, `packages/core` for runtime contracts already there):
- `packages/cli/src/runtime/profileApplication.ts` (835 lines) + `profile-application/`
- `packages/cli/src/runtime/providerSwitch.ts` (847 lines)
- `packages/cli/src/runtime/providerMutations.ts` (470 lines)
- `packages/cli/src/runtime/runtimeSettings.ts` (146 lines) and closely-coupled helpers (`runtimeContextFactory.ts`, `runtimeRegistry.ts`, `settingsResolver.ts`, `profileSnapshot.ts`) as the dependency graph dictates.

### The OAuth seam (the one real subtlety)

`providerManagerInstance.ts` depends on `packages/cli/src/auth/oauth-manager.ts`. Investigation:

- `oauth-manager.ts` (519 lines) is itself **UI-free** — it imports only `MessageBus`/`Config` from core and types from `@vybestack/llxprt-code-auth`.
- The 5 concrete OAuth *providers* (`gemini-/anthropic-/qwen-/codex-oauth-provider.ts`, `global-oauth-ui.ts`) appear "UI-coupled" but their only UI import is `type HistoryItemWithoutId` (a display-message type) — i.e. they need a way to **emit a user-facing message** (device code, browser URL), not React/ink itself.

Therefore the move must introduce a small **callback/event seam** for OAuth user prompts: the engine-side OAuth composition emits structured "show this to the user" events (or takes an injected `onUserPrompt` callback), and the CLI supplies the actual rendering. This keeps device-code/browser flows working while removing the type dependency on `ui/types`. The implementer decides whether `oauth-manager` + the OAuth providers move into `packages/auth` (which already owns token stores and flows) or into `packages/providers`; `auth` is the more natural home and `providers` already depends on `auth`.

### Out of scope (do NOT do these here)

- The `createAgent`/`Agent` public API itself — that is #1594 and is built **on top of** this relocation.
- The CLI thin-UI rewrite — that is #1595.
- Any change to provider *behavior*, auth *precedence*, or profile *semantics*. This is a **relocation + seam-introduction** refactor; behavior must be identical.
- Introducing a new package. Use the existing `providers`/`settings`/`core`/`auth` packages.

### Constraints (per dev-docs/RULES.md and #1568)

- **No backward-compatibility shims / re-export stubs** to avoid migrating imports. Update import sites directly. (#1568 requirement.)
- Behavior-preserving: existing tests for provider switching, profile application, alias resolution, credential precedence, and OAuth must pass unchanged (move the tests with the code).
- No new `any`; respect the existing strict lint/complexity rules.
- TDD: characterization tests assert identical behavior before and after the move; the OAuth-seam introduction gets behavioral tests proving prompts are still emitted (now via the callback/event seam) and tokens still resolve.

### Acceptance criteria

- [ ] Provider composition (`ProviderManager` construction + provider registration + content-generator-factory injection) lives in an engine package (recommended `packages/providers`), not in `packages/cli`.
- [ ] Profile application and provider/model switch pipeline live in engine packages (`providers`/`settings`/`core`), not in `packages/cli`.
- [ ] `packages/agents` depends on `packages/providers`, with no dependency cycle anywhere (verified by the build).
- [ ] A headless harness can construct a working provider (Gemini AND at least one of OpenAI/Anthropic) and run a completion **without importing anything from `packages/cli`**. This is the concrete unblock for #1594.
- [ ] OAuth device-code/browser prompts still work, now via a UI-agnostic callback/event seam; no engine file imports `ui/types` or React/ink.
- [ ] `a2a-server` (or an equivalent non-CLI consumer) can select a non-Gemini provider through the relocated composition.
- [ ] No backward-compat shims; all import sites updated (≈10 importers of `providerManagerInstance`, ≈16 importers of the runtime switch modules — verified counts).
- [ ] Full verification passes: test, lint, typecheck, format, build, and the profile smoke command.
- [ ] CLI retains only: TUI rendering, slash-command parsing, and the act of *invoking* the relocated engine composition.

### Suggested sequencing for the implementer

1. Introduce the OAuth user-prompt callback/event seam first (smallest, unblocks the auth dependency), with characterization tests.
2. Move provider composition (`providerManagerInstance` + alias/registration files) into `packages/providers`; update importers; keep tests green.
3. Add the `agents → providers` dependency edge; prove a headless provider build with no CLI import (the #1594 unblock test).
4. Move the profile/switch pipeline; update importers.
5. Reduce `packages/cli` to invoking the relocated composition; run full verification + smoke.

Parent: #1568. Unblocks: #1594.
