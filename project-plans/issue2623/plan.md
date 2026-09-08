# Plan: Remove the dead Code Assist enclave and tier system

Plan ID: PLAN-20260825-ISSUE2623
Generated: 2026-08-25
Issue: #2623

## Scope decision

The implementation follows the issue's removal rules. It deletes the Code Assist implementation and consumers rather than relocating or preserving them through aliases. The current tree differs from a few issue line references. In particular, the agents citation fallback now lives in `packages/agents/src/core/turnCitations.ts`, not `turn.ts`.

The error-formatting requirement removes Google free-tier and paid-tier quota guidance. A 429 error remains formatted with tier-independent quota guidance, but it must not vary by a deleted user tier or recommend the removed OAuth flow, authentication setup, or a paid AI Studio key. Anthropic may retain one tier-independent Anthropic message. Other providers use tier-independent rate-limit guidance. This follows the issue's instruction to remove the free/paid builders, `DEFAULT_GEMINI_MODEL` use in this module, and obsolete guidance constants.

## Acceptance criteria

### AC1: Code Assist implementation is absent

**Behavior**

- GIVEN the built source tree
- WHEN consumers resolve core exports
- THEN no `code_assist` module, subpath export, barrel export, compatibility alias, or relocated copy exists

**Evidence**

- `packages/core/src/code_assist/` is absent.
- The four dead CLI privacy files named in the issue are absent.
- The issue's two residual symbol greps return no matches.
- No new allowlist or exemption entry preserves the deleted surface.

### AC2: Missing provider composition fails immediately

**Behavior**

- GIVEN a `Config` with neither an injected content-generator factory nor a provider manager
- WHEN `createContentGenerator()` is called, including configurations that contain an API key or Vertex settings
- THEN it rejects with `No provider runtime is composed for this Config. Compose the providers package (see packages/providers/src/composition) before creating a content generator.`

**Boundary behavior**

- A composed provider manager plus injected factory continues to create the generator.
- A provider manager without the required factory continues to fail rather than falling back.
- `createContentGeneratorConfig()` environment parsing remains unchanged because its relocation belongs to later provider-contract work.

**Tests**

- Replace wrapper-construction tests with a behavioral rejection test against the real `createContentGenerator()` implementation.
- Keep the existing composed factory-path behavior test green.

### AC3: Citation display is settings-only

**Behavior**

- GIVEN citation output processing
- WHEN `ui.showCitations` is true or false
- THEN that setting alone controls citation display
- AND an absent setting defaults to false

**Boundary behavior**

- No server tier or Code Assist server lookup participates.
- Provider-neutral citation event generation and handling remain present.
- The live privacy notice and dialog components outside the four named dead files remain unchanged.

**Tests**

- Agents citation tests cover true, false, and absent settings through real gate behavior.
- CLI stream tests retain settings-service and merged-settings precedence coverage while deleting tier-fallback cases and mocks.

### AC4: User tiers are removed end to end

**Behavior**

- GIVEN core, agents, CLI session state, and a2a task metadata
- WHEN those APIs and state objects are compiled and exercised
- THEN they expose no `UserTierId`, `userTier`, `getUserTier`, or `SET_USER_TIER` member

**Tests and structural evidence**

- Typed contract-promotion checks and direct agent tests compile without the removed member.
- Loose test fixtures and mocks are updated, including references omitted from the issue inventory.
- The no-filter residual symbol grep returns no matches in TypeScript or TSX source.

### AC5: API error formatting has no tier or retired OAuth guidance

**Behavior**

- GIVEN structured, embedded JSON, string, or unknown API errors
- WHEN `parseAndFormatApiError()` formats them
- THEN its public arguments are `error`, optional `currentModel`, and optional `providerName`
- AND 429 guidance does not branch on a user tier or contain Gemini Code Assist, free-tier, paid-tier, `/auth`, authentication-setup, or AI Studio key guidance
- AND status suffixes, interrupted-stream formatting, non-429 formatting, Anthropic identification, and provider-neutral rate-limit handling remain operational

**Boundary behavior**

- Google quota detector details no longer select tier-specific messages.
- Existing production callers that passed literal `undefined` for the tier shift their remaining arguments left.
- The existing caller that passed only the error remains valid.

**Tests**

- Rewrite paid-tier cases as tier-independent behavioral assertions for structured, embedded JSON, string, and unknown 429 forms.
- Preserve non-429 and interrupted-stream tests.

### AC6: a2a-server no longer selects obsolete Gemini authentication

**Behavior**

- GIVEN a2a-server configuration loading with `USE_CCPA`, Gemini API-key, Vertex, or former OAuth-related environment values
- WHEN configuration is loaded
- THEN a2a-server performs no Code Assist, CCPA, OAuth-personal, Gemini API-key, or Vertex auth refresh

**Boundary behavior**

- General config loading remains functional.
- The README states that future a2a-server activation must compose the providers package before content generation.
- No providers dependency or new runtime abstraction is added in this issue.

**Tests**

- Existing a2a configuration, HTTP, and provider-neutral task tests are updated to the provider-uncomposed contract and remain green.

### AC7: Core no longer owns the GenAI SDK dependency

**Behavior and structural evidence**

- `packages/core/package.json` has no `@google/genai` dependency and no Code Assist export subpaths.
- Root and providers package declarations remain unchanged.
- No `@google/genai` import exists in core, agents, CLI, or a2a-server source.
- Provider Gemini production implementation is unchanged.

### AC8: GenAI guards and documentation describe the remaining enclave

**Behavior and structural evidence**

- GenAI import and manifest configuration sanctions only the root packaging bridge and the providers Gemini enclave as appropriate.
- Guard tests and inventory tests no longer create or expect core Code Assist cases.
- Published-root tests no longer require the core workspace to declare the dependency.
- Naming and ESLint guard baselines contain no entries for deleted files or imports.
- `dev-docs/genai-enclave-boundary-rules.md` and `dev-docs/genai-import-baseline.md` describe the post-removal state.

### AC9: Non-goals remain unchanged

No changes are made to:

- the remaining Gemini-shaped `ContentGenerator` methods beyond removal of `userTier`
- non-Code-Assist GenAI type work assigned to other subissues
- hook wire formats, checkpoints, or server tools
- root package ownership of the published-artifact bridge
- `createContentGeneratorConfig()` environment sniffing
- workflow configuration, agent memory, quality-tool behavior, or unrelated tests and refactors

A bounded baseline edit required because files are deleted is maintenance of the existing quality guard, not a change to its behavior.

### AC10: Verification and review gates pass on the candidate head

**Structural checks**

```bash
test ! -d packages/core/src/code_assist
grep -rn "code_assist" packages/*/src --include='*.ts' --include='*.tsx' | grep -v test
grep -rn "UserTierId\|CodeAssistServer\|getCodeAssistServer\|getUserTier\|SET_USER_TIER" packages/*/src --include='*.ts' --include='*.tsx'
node -e "const p=require('./packages/core/package.json'); console.log(p.dependencies['@google/genai']||'REMOVED')"
grep -rn "from '@google/genai'" packages/core/src packages/agents/src packages/cli/src packages/a2a-server/src
grep -rn "refreshConfigAuth\|refreshCcpaAuth\|resolveAuthSelection\|AuthSelection\|hasVertexCredentials\|USE_CCPA\|oauth-personal" packages/a2a-server/src --include='*.ts' --exclude='*.test.ts'
```

Expected results: directory absent; all greps produce no matches; dependency probe prints `REMOVED`.

**Required local cycle**

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

The test-audit scanner must report no new findings on changed tests. Deep review and Open Code Review findings must be classified as `Blocker-Fix`, `In-scope-Fix`, `Reject`, or `Defer`. All `Blocker-Fix` and `In-scope-Fix` findings must be resolved. CI and CodeRabbit must pass on the candidate head, review threads must be resolved, and the PR must be conflict-free with correct ancestry.

## Test-first implementation sequence

1. Record preflight inventories and run focused current tests.
2. Change `contentGenerator.test.ts` first so the new no-provider-runtime behavior fails while the wrapper fallback exists.
3. Rewrite citation and error-formatting behavioral expectations before removing their tier branches; run each focused test to observe the expected failure.
4. Update guard tests to describe the remaining provider-only enclave before changing guard configuration.
5. Make the minimum production, manifest, guard, and documentation edits that satisfy those tests.
6. Delete subjects and tests whose behavior is intentionally removed, then update typed fixtures and structural inventories.
7. Run focused suites, structural checks, test audit, and the full local cycle.
8. Complete deep review and no more than two local OCR rounds. Triage every finding using the required classifications.
9. Commit, create the PR, watch CI, complete no more than two PR OCR rounds if needed, resolve CodeRabbit findings, and verify ancestry and conflicts.

## Review triage policy

- `Blocker-Fix`: breaks an acceptance criterion, safety rule, architecture requirement, build, test, or CI gate.
- `In-scope-Fix`: valid defect or omission within AC1 through AC10.
- `Reject`: factually incorrect, already satisfied, or contrary to an acceptance criterion.
- `Defer`: valid adjacent work that belongs to another issue or an explicit non-goal.

Reviewer feedback does not change scope. Any proposed subsystem, public abstraction, workflow, memory, quality-tool behavior, dependency beyond the specified core removal, or unrelated refactor requires user approval before implementation.
