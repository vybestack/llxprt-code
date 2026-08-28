# Issues #3382 and #3383: the two remaining ways the model's skill list goes stale

Branch: `issue3382-3383`

Both defects were found while fixing #3379 and share its mechanism: the model
learns which skills exist only from the `activate_skill` tool declaration, which
`ActivateSkillTool` bakes in at construction. #3379 fixed the explicit
`/skills reload` path. These are the two remaining ways that declaration can be
wrong, and they are fixed together because the second one depends on a seam the
first one moves.

## #3382: the public Agent API never registers the tool

`Config` cannot reference `ActivateSkillTool` (#2417), so it receives the tool
through the injected `postSkillDiscoveryToolRegistrar` hook, and
`syncSkillActivationTool` returns early when no hook is present.

The CLI supplies one. `packages/agents/src/api/createAgent.ts` does not. So
`createAgent({ skillsSupport: true })` discovers skills, lists them happily
through `agent.skills.list()`, and never gives the model an `activate_skill`
tool at all. Reloading cannot help, because there is nothing to rebuild.

### Fix

Move `registerActivateSkillTool` from `packages/cli/src/config/` to
`packages/agents/src/skill-tool-registrar.ts` and export it from the agents root
barrel. Both composition roots then share one implementation, which is the point:
the two roots have already drifted once.

- `createAgent` sets `params.postSkillDiscoveryToolRegistrar = registerActivateSkillTool`
  next to the existing `params.agentClientFactory` assignment.
- `fromConfig` is the other public entry, and it adopts a `Config` the caller
  built. A caller has no reason to know the hook exists, so `fromConfig`
  installs the shared registrar when the adopted config has none, leaving a
  deliberately supplied one alone. `ensureInitialized` is a no-op for a config
  the caller already initialized, so when `fromConfig` installs the hook it also
  calls `refreshSkills()` to reconcile. On a fresh config that repeats one
  discovery, which is a better trade than leaving the model with no skill tool.
- `packages/cli/src/config/configBuilder.ts` imports it from
  `@vybestack/llxprt-code-agents` instead of its local module, which is deleted.

The agents **root barrel**, not a subpath: `scripts/cli-boundary/config.ts` lists
`'@vybestack/llxprt-code-agents': []`, meaning the CLI may import the bare root
and no deep paths. Using the root also avoids editing the curated exports map.

The registrar keeps importing `@vybestack/llxprt-code-tools/tools/activate-skill.js`
by deep path. `activate-skill.ts` itself does not pull `@ast-grep/napi`; the
tools *barrel* does, via `tools/structural-analysis/`. The deep path is what
keeps the native module out of the graph, so it must stay a deep path.

No `skillsSupport` gate at the call site: `syncSkillActivationTool` already
returns early when skills support is off, so wiring the hook unconditionally is
correct and keeps one gate rather than two.

## #3383: extension load and unload do not rediscover skills

`SkillManager.discoverSkills` reads extension-contributed skills:

```ts
for (const extension of extensions) {
  if (extension.isActive && extension.skills) { ... }
}
```

`ExtensionLoader.startExtension` / `stopExtension` reconcile MCP servers,
subagents and memory, and call `maybeRefreshAgentTools`, which only does anything
when the extension declares `excludeTools`. Skills are never rediscovered. So
loading an extension that ships skills leaves them invisible, and unloading one
leaves its skills listed and still in the enum, until an explicit `/skills reload`.

### Fix

**Split `Config.reloadSkills()` into settings-refresh plus a reusable refresh.**

```ts
async refreshSkills(): Promise<void> {
  await this.skillManager.discoverSkills(this.storage, this.getExtensions());
  this.skillManager.setDisabledSkills(this.disabledSkills);
  syncSkillActivationTool(this);
  const client = this.getAgentClientIfReady();
  if (client) {
    await client.setTools();
  }
}

async reloadSkills(): Promise<void> {
  if (this._onReload) { /* unchanged settings refresh */ }
  await this.refreshSkills();
}
```

This is a pure extraction: `refreshSkills` is exactly the current tail of
`reloadSkills`, so `/skills reload` behaviour does not change. No `skillsSupport`
guard is added to `refreshSkills`, because `reloadSkills` does not have one today
and adding one would silently change when discovery runs.

The extension path calls `refreshSkills`, not `reloadSkills`: an extension
transition should not re-read `disabledSkills` and `adminSkillsEnabled` from
settings, because the user did not ask for a settings reload and an unrelated
half-finished settings edit should not take effect as a side effect of an
extension loading.

**Make `ExtensionLoader` refresh when a skill-contributing extension settles.**

Mirror the existing `maybeRefreshMemory` shape:

- `startExtension` and `stopExtension` mark skills dirty when the extension
  actually contributes skills, so an extension with none costs nothing. The mark
  happens *before* the awaited MCP transition: `loadExtension` and
  `unloadExtension` mutate the collection `discoverSkills` reads before starting
  or stopping anything, so a rejected transition still leaves a stale skill
  surface that needs reconciling.
- Refresh only once every in-flight start and stop has settled, using the same
  counter comparison `maybeRefreshMemory` uses, so a batch of concurrent loads
  rediscovers once rather than once each. This does not collapse *sequential*
  transitions: `restartExtension` awaits its stop before its start, so each half
  settles on its own and rediscovery runs twice. That is left alone. A restart
  keeps the extension in the loader's list and active, so its skills stay
  available throughout and the second pass is redundant rather than wrong.
- Skip during the initial `start()`, guarded by the existing `isStarting` flag.
  `Config.initialize` runs `discoverSkills` immediately after
  `getExtensionLoader().start(this)` returns, so refreshing per-extension there
  would be redundant work whose result is immediately overwritten. The dirty
  flag is cleared on that path so the first real transition is not misattributed.
- Run after `maybeRefreshMemory`, not before. Memory and hook reconciliation
  predate this change, and a `refreshSkills` rejection must not stop them from
  happening.
- Restore the dirty flag if `refreshSkills` rejects, then rethrow. The failure
  still propagates; the marker only ensures the next transition retries instead
  of inheriting a surface that was never reconciled.

## Tests

Behavioral, per dev-docs/RULES.md. Assert on the registry and on the declaration
the chat session will send, not on call counts.

### #3382

- Move `packages/cli/src/config/activateSkillToolRegistrar.test.ts` to
  `packages/agents/src/skill-tool-registrar.test.ts` alongside the implementation.
  Its eight cases carry over unchanged.
- `packages/agents/src/api/__tests__/skillReloadDeclaration.behavior.test.ts`
  drops its manual `setPostSkillDiscoveryToolRegistrar` call and relies on
  production wiring, which is what its header comment promised would happen when
  #3382 was fixed. If the wiring regresses, all five cases fail.
- The first case in that file becomes the explicit startup assertion: an agent
  built through `createAgent` with a skill on disk exposes `activate_skill` in
  its provider-facing declarations after one turn and no reload at all.

### #3383

New `packages/core/src/config/extensionSkillRefresh.test.ts`, using the same
mock harness as `config.skillReload.test.ts` with a real `SimpleExtensionLoader`
and `enableExtensionReloading: true`:

- Loading an extension that contributes a skill puts that skill in the
  discovered set and in what the activation tool was rebuilt from, with no
  explicit reload.
- Unloading it removes the skill from both.
- An extension contributing no skills triggers no rediscovery at all.
- A restart leaves the skill available throughout.
- A batch of concurrent loads rediscovers once.
- A failed MCP transition still leaves the surface reconciled on the next one.
- A failed `refreshSkills` retries on the next transition.

Four of these fail on pre-fix code. The remaining link, that the rebuilt tool
reaches the provider request, is already covered end to end by
`skillReloadDeclaration.behavior.test.ts` in the agents package, so it is not
duplicated here.

New `packages/agents/src/api/__tests__/fromConfigSkills.behavior.test.ts`: an
agent built with `fromConfig` from a caller-built config that supplied no
registrar offers a discovered skill in its provider-facing declarations. Fails
on pre-fix code. `buildCliStyleConfig` gains an overrides parameter so the
config can enable skills and point at a workspace; existing callers are
unaffected.

### Known limitation, not fixed here

`refreshSkills` updates the foreground `AgentClient` only. A subagent already
running when an extension is loaded or unloaded keeps the declarations its
`ChatSession` was assembled with, so a later turn in that subagent can advertise
a stale enum. This is not specific to skills: the same is true of any registry
change during a subagent's lifetime, including MCP tool changes today. Fixing it
means propagating tool-surface changes into live subagent sessions, which is a
change to subagent runtime setup rather than to skill discovery.

### Regression

`packages/core/src/config/config.skillReload.test.ts` and
`packages/core/src/config/config.d.test.ts` must pass unchanged, since
`reloadSkills` is only being decomposed, not altered.

## Verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Plus the boundary guards that constrain this change:
`packages/core/src/config/__tests__/import-boundary.test.ts`,
`packages/providers/src/auth/__tests__/auth-import-isolation.test.ts`,
`scripts/tests/cli-import-boundary.test.ts`.
