# Issue #3379: `/skills reload` does not make skills usable by the model

Branch: `issue3379`

## Problem

`/skills reload` re-runs discovery on `SkillManager` but the model-facing surface
never changes. The only channel by which the model learns about skills is the
`activate_skill` tool declaration: its description carries an
`(Available: 'a', 'b')` hint and its `name` parameter is a `z.enum` of the skill
names. Both are baked into the `ActivateSkillTool` instance at construction.

That instance is constructed in exactly one place, the
`postSkillDiscoveryToolRegistrar` hook supplied by the CLI composition root
(`packages/cli/src/config/configBuilder.ts`), and that hook is invoked in exactly
one place, `Config.performInitialization()`.

`Config.reloadSkills()` does not invoke the registrar, and does not call
`AgentClient.setTools()` to push refreshed declarations into the live chat
session. Three user-visible failures follow:

1. A skill added on disk and picked up by `/skills reload` is absent from the
   `activate_skill` enum, so a model call naming it fails parameter validation.
2. `/skills enable <name>` and `/skills disable <name>` tell the user to run
   `/skills reload` "for it to take effect", but the tool schema does not change.
3. `performInitialization` only registers the tool when
   `getSkillManager().getSkills().length > 0`. A session that starts with zero
   enabled skills never registers `activate_skill` at all, and reload cannot
   recover it.

`AgentSkillsControl.reload()` (`packages/agents/src/api/control/skillsControl.ts`)
delegates to `Config.reloadSkills()`, so ACP and API consumers share the defect.

## Constraints

- `packages/core/src/config/config.ts` must not gain a value import from
  `@vybestack/llxprt-code-tools` and must not reference `ActivateSkillTool`.
  Enforced by `packages/core/src/config/__tests__/import-boundary.test.ts`
  (issue #2417). The zero-skill decision therefore belongs in the CLI registrar,
  not in core.
- Fail fast over defensive layering. Do not add try/catch swallows around the
  new registrar or `setTools()` calls; a failure during reload should surface
  through the existing `/skills reload` error path in `skillsCommand.ts`.
- Bun + TypeScript. New tests are `bun:test`. No new `.js` files.

## Design

### 1. Core: one shared sync step, invoked from init and reload

Extract the registrar invocation currently inlined in `performInitialization()`
into `packages/core/src/config/skill-tool-sync.ts`, mirroring the existing
`mcp-lazy-tool-sync.ts`:

```ts
export function syncSkillActivationTool(config: Config): void {
  if (!config.isSkillsSupportEnabled()) {
    return;
  }
  const registrar = config.getPostSkillDiscoveryToolRegistrar();
  const messageBus = config.getRuntimeMessageBus();
  if (!registrar || !messageBus) {
    return;
  }
  registrar(
    config.getToolRegistry(),
    new CoreSkillServiceAdapter(config),
    messageBus,
  );
}
```

`performInitialization()` already calls `setRuntimeMessageBus(initializationMessageBus)`
before skill discovery, so `getRuntimeMessageBus()` returns the same bus the
inline code used. Replace the inlined block (including the
`getSkills().length > 0` gate) with a call to `syncSkillActivationTool(this)`.

A separate module rather than a private method for two reasons: `config.ts` sits
at the 800-line `max-lines` limit, and a method named `syncActivateSkillTool`
would contain the substring `ActivateSkillTool`, which the issue #2417 boundary
guard rejects anywhere in `config.ts`.

### 2. Core: reload re-syncs the tool and refreshes the live session

```ts
async reloadSkills(): Promise<void> {
  if (this._onReload) { /* unchanged */ }
  await this.skillManager.discoverSkills(this.storage, this.getExtensions());
  this.skillManager.setDisabledSkills(this.disabledSkills);

  syncSkillActivationTool(this);

  const client = this.getAgentClientIfReady();
  if (client) {
    await client.setTools();
  }
}
```

This mirrors `refreshMcpContext()`, which already re-registers its activation
tool and then calls `client.setTools()`. `updateSystemInstruction()` is NOT
needed: llxprt's assembled system prompt contains no skill list (the
`<available_skills>` text in `packages/core/src/core/__snapshots__/prompts.test.js.snap`
is inherited upstream snapshot content, not something our prompt assembly
produces).

`ToolRegistryView.listToolNames()` is backed by the live registry
(`packages/core/src/runtime/runtimeAdapters.ts`), so a freshly registered tool is
not filtered out of the declarations built by `buildToolDeclarationsFromView`.

### 3. CLI: registrar becomes a two-way sync

`packages/cli/src/config/configBuilder.ts`:

```ts
postSkillDiscoveryToolRegistrar: (toolRegistry, skillService, messageBus) => {
  toolRegistry.unregisterTool(ActivateSkillTool.Name);
  if (skillService.listSkills().length > 0) {
    toolRegistry.registerTool(new ActivateSkillTool(skillService, messageBus));
  }
},
```

Core now calls the registrar unconditionally (when skills support is on) and the
composition root decides whether the tool should exist. When every skill is
disabled or removed, `activate_skill` is unregistered rather than left behind
with a stale enum. `CoreSkillServiceAdapter.listSkills()` already filters out
disabled skills, so the enum and the registration decision use one source.

The closure is extracted to `packages/cli/src/config/activateSkillToolRegistrar.ts`
as `registerActivateSkillTool` so it can be unit tested directly against a real
`ToolRegistry`. `PostSkillDiscoveryToolRegistrar` is exported from the core
barrel so the composition root can type its implementation.

Update the doc comment on `PostSkillDiscoveryToolRegistrar` in
`packages/core/src/config/configTypes.ts` to say the hook is called after every
skill discovery (initialization and reload) and is responsible for both
registering and unregistering.

## Tests (write first)

All behavioral, asserting observable outcomes rather than call counts wherever
the observable outcome is reachable. Follow dev-docs/RULES.md.

### `packages/core/src/config/config.skillReload.test.ts` (new file)

A dedicated file rather than an extension of `config.d.test.ts`, because that
file is also at the 800-line `max-lines` limit. It reuses the same mock harness
so `Config.initialize()` runs without touching disk, git or a real provider.

- After `reloadSkills()`, the injected `postSkillDiscoveryToolRegistrar` has been
  invoked with the live tool registry and a skill service whose `listSkills()`
  reflects the post-reload skill set. Assert on the skill service contents, not
  merely that a function was called.
- With `skillsSupport: false`, `reloadSkills()` does not invoke the registrar.
- When an initialized agent client is present, `reloadSkills()` results in the
  client's tool declarations being refreshed. When no client is ready,
  `reloadSkills()` completes without throwing.
- A registrar failure propagates out of `reloadSkills()` rather than being
  swallowed into a false "reloaded successfully" report.
- The existing assertions in `config.d.test.ts` about `discoverSkills` /
  `setDisabledSkills` / `setAdminSettings` continue to pass unchanged.

### `packages/core/src/config/__tests__/import-boundary.test.ts`

No change expected; it must still pass. The new core code introduces no value
import from the tools barrel and no `ActivateSkillTool` reference.

### CLI registrar behavior

New or extended test covering the registrar closure produced by
`createConfigFromInput` (or the extracted registrar function, if the
implementation factors it out for testability):

- With a skill service reporting one or more skills, `activate_skill` is present
  in the registry and its declaration's `name` enum contains those skill names.
- Re-invoking the registrar after the skill service starts reporting an extra
  skill yields a declaration whose enum contains the new name and whose
  description mentions it.
- Re-invoking the registrar when the skill service reports zero skills removes
  `activate_skill` from the registry.

Prefer a real `ToolRegistry` and a hand-written fake `ISkillService` over mocks
of the registry.

### `packages/tools/src/tools/activate-skill.test.ts`

Add coverage pinning the contract the fix depends on: a tool constructed from a
skill service listing skills A and B exposes both in the `name` enum and both in
the description hint; constructed from an empty service, the schema does not
enumerate names. This guards the assumption that rebuilding the instance is what
refreshes the model-facing surface.

### `packages/agents/src/api/__tests__/skillsControl.behavior.test.ts`

`SkillsControl.reload()` drives the same refresh as the slash command: after
reload the bound config's tool registry exposes an `activate_skill` declaration
matching the post-reload skill set.

### `packages/cli/src/ui/commands/skillsCommand.test.ts`

Existing tests must keep passing. No behavioral change to the command itself; it
already delegates to `config.reloadSkills()`.

## Out of scope

`ActivateSkillTool` caching its skill list in the constructor is the deeper
design smell. Making the declaration lazy would remove this class of staleness
entirely, but it is a change to `BaseDeclarativeTool`'s contract and is tracked
separately. Steps 1 through 3 fix the reported bug without it.

## Verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Manual check: start the CLI, add a skill directory under `.llxprt/skills/`, run
`/skills reload`, and confirm the model can call `activate_skill` with the new
name. Then `/skills disable` it, reload, and confirm the name is gone.
