# Plan: Remove the getFolderStructure feature (system-prompt folder tree) and its settings (#3072)

Plan ID: PLAN-20260826-ISSUE3072
Generated: 2026-08-26
Issue: #3072
Status: In progress

## Problem statement

`getFolderStructure` (`packages/core/src/utils/getFolderStructure.ts`) is a
vestigial part of gemini-cli that this project disabled long ago. It is a real
hazard for any caller that enables it: `buildPromptContext` calls
`getFolderStructure(cwd)` per request with no memoization and injects the result
into the cached system block (`packages/core/src/core/prompts.ts`), so a coding
agent invalidates its own prompt cache every time it creates or deletes a file. The
feature defaults to `false` (`include-folder-structure`), but it is live in the
built-in environment context, is documented, and ships in three legacy gemini
prompt templates — a genuine attack on prompt cache hit rate for anyone who turns it on.

The issue asks: remove the getFolderStructure feature entirely, including its settings
and its tests.

## Verdict on scope (what "its tests" means)

`getFolderStructure` has exactly two production consumers:

1. `packages/core/src/utils/environmentContext.ts` —
   `getDirectoryContextString()` calls `getFolderStructure()` unconditionally for
   every workspace directory, so the folder tree is always present in the environment
   context part even when `include-folder-structure` is false. The built-in env
   context is prepended to the system instruction on every chat start /
   `updateSystemInstruction`, which is precisely the cache-hazard path the issue
   names.
2. `packages/core/src/tools-adapters/CoreSkillServiceAdapter.ts` — the skill
   activation tool (`ISkillService.getFolderStructure(skillName)`) reads the skill
   resource directory recursively and surfaces the listing in the activation result /
   confirmation prompt. This is a *different* feature that shares the same underlying
   walker. The `activate-skill` tool and its `ISkillService` interface member are
   owned by `packages/tools`, and `activate-skill.test.ts` /
   `interface-contracts.test.ts` (ISkillService contract) are behavioral tests of
   THAT surface. **The skill `getFolderStructure(skillName)` member and the
   `CoreSkillServiceAdapter` skill-listing path are IN SCOPE to remove** (they are
   part of "the getFolderStructure feature" and are untested by any dedicated test).
   The `getFolderStructure(directory)` walker itself is only used by those two
   consumers; removing both consumers orphans it, so we delete the util and its export
   too.

The issue title says "including ... any tests or whatever". We defer NOTHING that
belongs to the deleted feature. Tests that exercise the deleted surface are removed; tests
that merely *reference* the related skill-listing shape via the skill service are
removed with that surface.

### Explicitly NOT in scope (independent features that must stay)

- `FileDiscoveryService` / `FileDiscoveryServiceAdapter` / `FileFilteringOptions`
  (the ignore/`.llxprtignore` machinery) — unrelated to the folder-tree util.
- `shell` / `activate-skill` confirmation flow, `ToolGovernance` / skill
  manager, `.llxprt/skills` loading. The `ISkillService` skill-listing
  member is removed; the skill *system* stays.
- `enable-tool-prompts` (a sibling setting that happens to live in the same
  `resolveFolderStructureSettings` helper).
- `docs/reference/ephemerals.md` and `docs/settings-and-profiles.md` always keep
  a `docs/` index entry (only the `include-folder-structure` row is removed).
- Anything in `packages/mcp`, `packages/a2a-server`, `packages/policy`,
  `packages/cli` — verified: no `getFolderStructure` / `folderStructure`
  references outside the surface listed below.

## Accepted behavior (acceptance criteria)

### AC1: No folder tree is ever injected into the system prompt

- GIVEN `include-folder-structure` is unset OR explicitly `false` (the
  default) OR explicitly `true`
- WHEN `getEnvironmentContext(config)` runs (chat start /
  `updateSystemInstruction`)
- THEN the returned text part does NOT contain `getFolderStructure`'s "Showing up
  to N items (files + folders)." listing or the "Here is the folder structure..."
  header, and no directory walk occurs. The env context still contains the date,
  OS, working-directory preamble, and `config.getEnvironmentMemory()`.
- GIVEN `getCoreSystemPromptAsync()` runs
- THEN the resolved system prompt does not contain `FOLDER_STRUCTURE` content
  (`{{FOLDER_STRUCTURE}}` unresolved or resolved is gone), and no file-walk
  happens.

### AC2: The `include-folder-structure` setting is removed

- GIVEN the settings registry, profile type, and profile manager
- THEN there is no `include-folder-structure` key anywhere in
  `packages/settings`, and the docs row that referenced it is gone.
- GIVEN `resolveFolderStructureSettings()` is removed
- THEN `enable-tool-prompts` resolution still works identically.

### AC3: The folder-walker util is removed; only unrelated util surface remains

- GIVEN the core index and package export map
- THEN `getFolderStructure` is no longer exported; `getFolderStructure.test.ts` is
  deleted.
- GIVEN `getDirectoryContextString` / `INITIAL_HISTORY_LENGTH` /
  `environmentContext.ts`
- THEN `getDirectoryContextString` keeps its exported `Promise<string>` contract
  but returns only the working-directory preamble (no tree), `INITIAL_HISTORY_LENGTH`
  and the `environmentContext.js` `INITIAL_HISTORY_LENGTH` re-export in `index.ts`
  are removed, and `environmentContext.ts` itself is kept as the env-context
  module for its existing importers.

### AC4: The skill-activation `getFolderStructure(skillName)` surface is removed

- GIVEN the `ISkillService` interface, `SkillActivationResult.folderStructure`,
  and the `CoreSkillServiceAdapter` `getFolderStructure(skillName)` /
  `folderStructureCache`
- THEN they are deleted, the confirmation prompt and `<available_resources>`
  block no longer render a folder listing, and the `activate-skill` tool still
  activates skills, returns instructions, and surfaces the resource directory when
  provided. The `ISkillService` shape only keeps `activateSkill`,
  `getSkillManager`, `listSkills`, `getSkill`.

### AC5: The three legacy gemini templates + doc row are cleaned

- GIVEN the gemini core templates and the template-variable doc table
- THEN `{{FOLDER_STRUCTURE}}` is removed from all three legacy gemini templates
  and from `docs/prompt-configuration.md`, and `TemplateEngine`/`PromptEnvironment`
  no longer carry a folder-structure variable.

### AC6: No public API surface regression outside the removed feature

- The full working tree must be free of `getFolderStructure`,
  `folderStructure`, `include-folder-structure`, and `FOLDER_STRUCTURE`
  (case-insensitive) references except in documentation/records that are
  intentionally kept (this plan, project-plans history, `dist/` build outputs).
- The full verification cycle (test, lint, typecheck, format, build) passes.

## Verified inventory (reads, all confirmed before writing this plan)

### Production (remove)

- `packages/core/src/utils/getFolderStructure.ts`
- `packages/core/src/utils/environmentContext.ts` (`getDirectoryContextString`,
  `getEnvironmentContext`, `INITIAL_HISTORY_LENGTH`)
- `packages/core/src/core/prompts.ts`: `MAX_FOLDER_STRUCTURE_*`,
  `extractFolderStructureHeader`, `compactFolderStructureSnapshot`,
  `resolveFolderStructureSettings` (folder-structure half),
  `resolveFolderStructure`, `buildEnvironment`'s `folderStructure` field,
  `buildPromptContext`'s call, `getFolderStructure` import
- `packages/core/src/prompt-config/types.ts`:
  `PromptEnvironment.folderStructure`
- `packages/core/src/prompt-config/TemplateEngine.ts`:
  `addEnvironmentVariables`'s `FOLDER_STRUCTURE` assignment
- `packages/core/src/tools-adapters/CoreSkillServiceAdapter.ts`:
  `getFolderStructure` import, `folderStructureCache`,
  `getFolderStructure(skillName)`, `activateSkill`'s folder listing
- `packages/tools/src/tools/activate-skill.ts`: `folderStructure` cache,
  `getOrFetchFolderStructure`, `folderStructure` in confirmation + `execute`
- `packages/tools/src/interfaces/ISkillService.ts`:
  `folderStructure` (SkillActivationResult) and `getFolderStructure(skillName)`
- `packages/settings/src/settings/registry/registry-entries-2.ts`:
  `include-folder-structure` entry
- `packages/settings/src/profiles/types.ts`: `'include-folder-structure'`
- `packages/settings/src/profiles/ProfileManager.ts`: both
  `include-folder-structure` mappings
- `packages/core/src/index.ts`: `export * from './utils/getFolderStructure.js'`
  and `export { INITIAL_HISTORY_LENGTH } from './utils/environmentContext.js'`
- `packages/core/package.json` export map:
  `./utils/getFolderStructure.js` (the `./utils/environmentContext.js` subpath
  export is retained — the module survives with its two kept functions)
- Templates: `{{FOLDER_STRUCTURE}}` in (3)
  `packages/core/src/prompt-config/defaults/providers/gemini/core.md` and
  `.../gemini-2.5-flash/core.md` and
  `.../gemini-2.5-flash/gemini-2-5-flash/core.md`
- Docs: `include-folder-structure` rows in
  `docs/settings-and-profiles.md` and `docs/reference/ephemerals.md`;
  `{{FOLDER_STRUCTURE}}` row in `docs/prompt-configuration.md`

### Tests (remove with the feature)

- `packages/core/src/utils/getFolderStructure.test.ts` (deleted with the util)
- `packages/core/src/utils/environmentContext.test.ts` (deleted with the util's
  only in-core consumer `environmentContext.ts`)
- The `compactFolderStructureSnapshot` import + truncation test in
  `packages/core/src/core/prompts-async.test.ts`
- The `getFolderStructure` mock in each of the 12 agent client test files:
  `client.sendMessageStream.test.ts`, `client.sendMessageStream-overflow.test.ts`,
  `client.sendMessageStream-toolContent400.test.ts`, `client.hooks.test.ts`,
  `client.ide-context.test.ts`, `client.sendMessageStream-thinking.test.ts`,
  `client.sendMessageStream-errors.test.ts`,
  `client.sendMessageStream-invalid-stream.test.ts`, `client.methods.test.ts`,
  `client.editor-context.test.ts`, `client.lifecycle.test.ts`,
  `client.model-profile.test.ts`,
  `client.sendMessageStream-overflow-compression.test.ts`
- The `folderStructure` fixture + `getFolderStructure` mock in
  `packages/agents/src/core/subagent.create.test.ts` (the mock of the removed
  env-context module branch) and the `ISkillService` `folderStructure` +
  `getFolderStructure` in `packages/tools/src/tools/activate-skill.test.ts`
- `getFolderStructure` + `SkillActivationResult.folderStructure` references in
  `packages/tools/src/__tests__/interface-contracts.test.ts` (ISkillService
  contract — the member is removed, so the contract test is reduced)
- `packages/core/src/prompt-config/TemplateEngine.test.ts` `folderStructure`
  fixture (the `PromptEnvironment` field is removed)
- `INITIAL_HISTORY_LENGTH` direct export tests elsewhere in
  `packages/agents/src/core/__tests__`/`ChatSessionFactory.test.ts` if any
  (verified: the only reactor import is the `environmentContext.js` mock in the 12
  agent client files plus `client.test.ts` import — all listed)

### Behavioral regression tests that MUST stay green (prove no over-deletion)

- `getEnvironmentContext` behavioral suites that assert env context still carries date
  / OS / `getEnvironmentMemory` are re-written against the new env function (the
  3 shell/reactor files that mock `environmentContext.js`: the 12 client files, plus
  `client.test.ts`, `subagent.create.test.ts`, `ChatSessionFactory.test.ts`,
  `ChatSessionFactory.tokenReestimate.test.ts`, `subagent.buildParts.test.ts`,
  `subagent.runNonInteractive.test.ts`, `subagent.runNonInteractive-term.test.ts`,
  `subagent.stream-idle.test.ts`, `subagent.runNonInteractive-execution.test.ts`).
  These files keep their mock of the (retargeted) env context module and continue to
  prove: env context is prepended, `read_many_files` tool behavior, model
  identity / interaction-mode wiring, and subagent feature loads. NONE of their
  assertions touch the removed folder listing — verified line-by-line in all of them.
- `core-history.spec.ts` T14b (`addDirectoryContext`), `mutationCoverage...`
  P23.c (`addDirectoryContext`), `apiSessionControl...`, `agentUnconfigured...`,
  `config.agentInversion.test.ts` — all use the PUBLIC agent surface
  (`agent.addDirectoryContext` / `client.addDirectoryContext` /
  `getDirectoryContextString`) — IN SCOPE to REMOVE, but the underlying
  `getEnvironmentContext` / system-prompt prepend / `tolerance` behaviors they
  assert are OUT of the folder feature. They assert the CONTEXT TOOL surfaces, not the
  folder tree. They must keep passing; only the folder-tree-specific assertions are
  removed from them (T14b / P23.c continue to assert addDirectoryContext is
  delegated and adds a history frame — see AC note; the executor API
  `agent.addDirectoryContext()` remains a public method delegating to
  `client.addDirectoryContext()`, which keeps appending env context).
- `prompts-async.test.ts` (subagent-delegation + MCP blocks, `IS_GIT_REPO`,
  sandbox, `{{`/`${`/`Tool.Name` leak checks) — only the single
  folder-structure test is removed; the rest stay.

### Key deletion is NOT the issue's `disable long ago` target

The issue body's "vestigial part of gemini-cli we disabled long ago" is the
`include-folder-structure` **system-prompt** feature (prompts.ts path). The skill
`getFolderStructure(skillName)` member is a *separate* skill-listing that happens
to reuse the same walker. It has no dedicated test; it is part of the feature we
are removing and must go with it, but its `ISkillService` interface + activate
tool pipeline and the `client`/`executor` env-context prepend pipeline are NOT
folder-tree and stay.

## Acceptance criteria (behavioral)

### AC-1 — Built-in env context contains date / OS / environment memory, no folder tree

- GIVEN a workspace with 1 or N directories and `getEnvironmentMemory()` returning M
- WHEN `getEnvironmentContext(config)` / `getDirectoryContext*` (retargeted) runs
- THEN the env context part includes the date line, the OS line, and M; the folder
  names and `Here is the folder structure...` listing are absent; the workspace
  directory list is still present (1-directory and N-directory preambles).
- GIVEN N dirs and `read_many_files` resolve → exactly one env part, no folder
  listing.

### AC-2 — System prompt no longer resolves `FOLDER_STRUCTURE`

- GIVEN `include-folder-structure` was the only producer of
  `PromptEnvironment.folderStructure` upstream
- THEN `buildPromptContext` performs no file walk, `PromptEnvironment` has no
  `folderStructure`, `TemplateEngine` sets no `FOLDER_STRUCTURE`, and the three
  gemini templates no longer mention it. `prompts-async.test.ts`'s non-folder
  cases stay green.

### AC-3 — Skill activation keeps working without a listing

- GIVEN a skill present in the manager
- WHEN `ActivateSkillTool.execute` succeeds
- THEN llmContent contains `<activated_skill name>`, `<instructions>`, and
  `</available_resources>` (empty resources section or resource-directory
  line), succeeds, and returns `returnDisplay` naming the resource directory; the
  ILSLL `ISkillService` shape has no `folderStructure` /
  `getFolderStructure(skillName)`.
- GIVEN the skill service contract test
- THEN it still asserts `activateSkill` / `getSkillManager` / `listSkills` /
  `getSkill` and does not mention `folderStructure`.

### AC-4 — `include-folder-structure` setting absent

- GIVEN registry / profile type / ProfileManager and both doc rows
- THEN a grep for `include-folder-structure` returns nothing outside
  non-source records (`project-plans/`, `dist/`).

### AC-5 — Dead surface gone

- GIVEN the working tree
- THEN `packages/core/src/utils/getFolderStructure.ts`, its test, the
  folder-tree parts of `environmentContext.ts`, `prompts.ts` folder helpers, the
  `core/package.json` `getFolderStructure.js` export-map entry, `index.ts`
  re-exports, `TemplateEngine`/`types` folder-structure members, the
  `addDirectoryContext` folder-list content, and the `ISkillService` folder
  member are all removed, and grep for
  `folderStructure|FOLDER_STRUCTURE|getFolderStructure` in `packages/` src
  yields none.

### AC-6 — Deleted-feature tests deleted

- GIVEN the verified inventory
- THEN `getFolderStructure.test.ts`, `environmentContext.test.ts` (replaced by a
  sibling env-context test without a listing), the `compactFolderStructureSnapshot`
  test, the 12 client-file mocks, the `folderStructure` fixtures in
  `activate-skill.test.ts` / `interface-contracts.test.ts`, and `INITIAL_HISTORY_LENGTH`
  mock-only references are removed; remaining tests that keep the CONTEXT-prepend
  behaviors stay green.

### AC-7 — Old docs/templates list no folder-structure tokens

## Verification

Full cycle per the issue workflow (run by the implementer, the reviewer, and
after any remediation):

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

## Test-first ordering

1. Write NEW `packages/core/src/utils/envContextCore.test.ts` (a focused,
   behavioral env-context test that asserts date/OS/memory present and folder
   listing absent) and the RED proof: it fails at HEAD (the folder listing IS
   present at HEAD, so the `not.toContain('Here is the folder structure...')`
   assertion is RED today). Record the RED run.
2. Implement the removal in the core env module, prompts, TemplateEngine,
   types, templates, skill adapter + ISkillService + activate-skill, profile /
   registry / index / package.json, and docs. Also delete the listed tests /
   references. Then the new env test goes GREEN and the remaining keep-green suites
   pass.
3. Remove the now-gone `addDirectoryContext` folder-listing delegation content
   and its assertions, keeping T14b/P23.c meaningful (the public
   `agent.addDirectoryContext()` remains a live method that via env context adds a
   non-empty frame).
4. Full verification cycle.

## Out of scope / deferred

- The core-history/mutationCoverage `addDirectoryContext` public-API delegations
  themselves (the live context-append surface) — they do not mention the folder tree;
  only their folder-list content is removed. If triage disagrees, that is a
  Blocker/in-scope finding to confirm with the user BEFORE widening.
- `FileDiscoveryService`/ignore machinery (unrelated).
- Any perf/profiling around the cache issue beyond removing the walker.
- No dependency, agent-memory, quality-tool, or workflow change.
