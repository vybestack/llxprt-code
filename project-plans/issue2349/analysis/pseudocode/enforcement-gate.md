# Pseudocode: CI enforcement gates (core AST gate + test-fixture gate + central allow-list)

Plan: PLAN-20260707-AGENTNEUTRAL — REQ-012.1/.2/.3, OQ-8/OQ-17, §8/§8.1.
Target: `scripts/agents-neutral-gate.ts` (NEW core gate), `scripts/agents-neutral-test-gate.ts` (NEW test gate), `dev-docs/agents-neutral-gate-allowlist.md` (NEW central allow-list).

## Interface Contracts

INPUTS: by DEFAULT, all files under `packages/agents/src` (core gate: production only, exclude `*.test.*`/`*.spec.*`/`__tests__`/`*-test-helpers*`; test gate: test files only); the central allow-list artifact. The DEFAULT scan root is OVERRIDABLE by an explicit CLI input contract (Critical 2) so the gate can be run against fixture files/trees:
  - `--files <path...>` and/or trailing positional file paths: evaluate EXACTLY the given file path(s) instead of the default scan (each path parsed + all checks applied with identical AST + allow-list semantics). Positional non-flag arguments are treated as `--files` entries.
  - `--root <dir>`: replace the default scan root `packages/agents/src` with `<dir>` (same production/test exclusion globs applied relative to `<dir>`).
  - When neither is given, the default `packages/agents/src` scan is used. `--files` and `--root` are mutually usable but if both are present `--files` takes precedence (explicit file list wins).
  The AST checks, allow-list AST-context matching, `--count`/`--by-file`/`--enforce-imports` semantics are IDENTICAL regardless of input source; only the SET of files scanned changes. This is the contract P02/P29/P31 implement and P02a/P30 fixture verification invoke (e.g. `--enforce-imports <fixture-path>` evaluates that fixture file).
OUTPUTS: exit 0 (clean) or exit 1 with a per-hit message (file + AST context + reason). MUST be AST/parser-based, NOT bare-name grep.
DEPENDENCIES (real): a TypeScript parser (typescript compiler API / ts-morph — verify availability in preflight) to walk import specifiers + structural literal/call nodes.

## Core gate (REQ-012.1) — over production files

```
9:  FUNCTION resolveInputFiles(argv): string[]        // Critical 2 — explicit input contract
9a:   // --files <path...> or trailing positional paths OVERRIDE the default scan (evaluate EXACTLY those files)
9b:   IF argv has --files OR trailing positional file paths: RETURN [those explicit paths]
9c:   // --root <dir> OVERRIDES the default scan root, same production/test exclusion globs
9d:   root = argv.root ?? 'packages/agents/src'
9e:   RETURN productionFilesUnder(root)               // default when neither --files nor positional paths given
10: FUNCTION runCoreGate(argv): number
11:   allowlist = parseAllowlist('dev-docs/agents-neutral-gate-allowlist.md')   // central, versioned (OQ-17)
12:   hits = []
13:   FOR file IN resolveInputFiles(argv)             // default packages/agents/src, OR --files/--root override (Critical 2)
14:     ast = parse(file)
15:     hits += checkA_rawGenaiImports(ast)          // import ... from '@google/genai'
16:     hits += checkB_bannedSymbolImports(ast)       // Part/Content/GenerateContentResponse/... imported/aliased from @google/genai|clientContract|geminiContent
17:     hits += checkC_contractPayloadImports(ast)     // ContractPart/ContractContent/... import-specifier or type-alias
18:     hits += checkD_roundtripSymbols(ast)           // sdkTypeBridge/convertIContentToResponse/streamChunkWrapper/responseToModelStreamChunk/chunkToParts/providerStopReason/setProviderStopReason/getProviderStopReason
19:     hits += checkE_enumRedeclare(ast)              // enum FinishReason{STOP='STOP'..} / object literal w/ Gemini Type|FinishReason uppercase values
20:     hits += checkF_structuralEnvelopes(ast)        // see below — structure, not bare identifier
21:     hits += checkG_converterCallsAndBarrel(ast)    // ContentConverters.toGeminiContent(s)( calls; import GeminiContent/GeminiContentPart/GeminiFunctionCall
22:     hits += checkH_usageKeys(ast)                  // promptTokenCount/candidatesTokenCount/cachedContentTokenCount/totalTokenCount outside boundary modules
23:   unexempted = hits.filter(h => NOT allowlist.matchesAstContext(h))    // AST-context match is authoritative (OQ-17)
24:   FOR h IN unexempted PRINT `${h.file}: ${h.contextDesc} — ${h.reason}`
25:   RETURN unexempted.length === 0 ? 0 : 1
25a: FUNCTION runEnforceImports(argv): number          // `--enforce-imports` mode (P02 cheap #2424 vectors; Major 6)
25b:   allowlist = parseAllowlist(...)
25c:   hits = []
25d:   FOR file IN resolveInputFiles(argv)             // same input contract — default scan OR --files/--root/positional fixture path (Critical 2)
25e:     ast = parse(file)
25f:     hits += checkA_rawGenaiImports(ast) + checkB_bannedSymbolImports(ast) + checkC_contractPayloadImports(ast) + checkE_enumRedeclare(ast)
25g:   unexempted = hits.filter(h => NOT allowlist.matchesAstContext(h))
25h:   RETURN unexempted.length === 0 ? 0 : 1          // GREEN on clean fixture, RED (exit 1) on any (a)(b)(c)(e) vector fixture
26: FUNCTION checkF_structuralEnvelopes(ast): Hit[]
27:   // MATCH (Gemini structure), NOT bare `candidates:`/`parts:`:
28:   //  F1: object literal with candidates:[ {content:{role?,parts?}} ]  (nested content w/ role|parts)
29:   //  F2: `as GenerateContentResponse` / `: GenerateContentResponse` annotations/casts
30:   //  F3: object literal with role:'user'|'model' AND parts:
31:   //  F4: {...parts...}/{...candidates...} literal passed to addHistory/setHistory/storeHistoryForLaterUse/resumeChat/filterHookRestrictedContent(s)/toIContent/toGeminiContent(s)
32:   //  F5: generic .parts read/reconstruct on a value typed structurally (T extends {parts?}) or content.parts / {...x, parts:...} where x is NOT neutral IContent (neutral uses .blocks)
33:   // EXCLUDE (false positives): candidates: typed as *Candidate[]/PublicProfileCandidate[]/CompressionLoadBalancerCandidate[]
34:   //   (CompressionLoadBalancingProvider.ts:34, CompressionProfileResolver.ts:401, profilesControl.ts:392)
35:   RETURN matches
36: FUNCTION checkH_usageKeys(ast): Hit[]
37:   // OQ-3t COMMITTED NEUTRAL: core/turnLogging.ts is NOT a boundary module / NOT allow-listed.
37a:  // Major 4 (round 8): the exemption is AST-CONTEXT, NOT file-level. event-types.ts/event-schema.ts exempt the
37a:  //   DECLARED TYPE MEMBERS only; eventAdapter.ts exempts ONLY the usageStatsToPublicUsageMetadata FUNCTION BODY.
37b:  //   A Gemini-usage-key literal elsewhere in eventAdapter.ts (outside the mapper) STILL fires — the whole file is NOT exempt.
38:   hits = literalsOrTypeMembersUsingGeminiUsageKeys(ast)   // collect every usage-key node (fires in turnLogging.ts too — it must be fully neutral)
38a:  // AST-context allow-listing (via allowlist.matchesAstContext at line 23) subtracts ONLY:
38a:  //   - event-types.ts/event-schema.ts: nodes that are members of the DECLARED UsageMetadataValue type
38b:  //   - eventAdapter.ts: nodes whose ENCLOSING FUNCTION is usageStatsToPublicUsageMetadata
38c:  //   (a bare file-path allow-list key is REJECTED — same rule as G3/hookWireAdapter)
39:   RETURN hits   // line 23 applies the AST-context allow-list; a usage-key node in api/ outside the mapper body / declared type is NOT exempt
39a: FUNCTION runCheckUsageKeyBoundary(argv): number   // `--check-usage-key-boundary` mode (P19 Major 4 tie; targeted checkH over api/)
39b:   // Runs checkH over packages/agents/src/api ONLY, with the AST-context allow-list (lines 38a-38c).
39c:   hits = checkH_usageKeys(parse each file under packages/agents/src/api)
39d:   unexempted = hits.filter(h => NOT allowlist.matchesAstContext(h))   // mapper-body / declared-type nodes only
39e:   RETURN unexempted.length === 0 ? 0 : 1   // exit 1 on any usage-key node in api/ outside the mapper body / declared type
```

## CLI modes: `--count` (net ratchet) + `--by-file` (per-site detail) (REQ-012.1, Major 4/5)

```
40: FUNCTION runCount(argv): number                  // `--count` mode (shrink-ratchet, P02 onward)
41:   allowlist = parseAllowlist(...)
42:   hits = collectAllHits(resolveInputFiles(argv))  // default packages/agents/src, OR --files/--root override (Critical 2); detection over the checks IMPLEMENTED AT THAT TIME (Major 2):
42a:  //   at P02: checkA/B/C/E (import/alias/enum, --enforce-imports) + checkF structural + checkG-call.
42b:  //   at P31 (after the documented re-baseline): the FULL checkA..H incl. checkD/checkG-barrel/checkH.
42c:  //   The metric's MEANING is stable (non-exempt hits from the checks implemented at that time); the join
42c:  //   of D/G-barrel/H at P31 is an EXPLICIT re-baseline step, NEVER a silent redefinition mid-plan.
43:   unexempted = hits.filter(h => NOT allowlist.matchesAstContext(h))
44:   PRINT unexempted.length ; RETURN 0              // prints ONLY the integer non-exempt structural-hit total
45: FUNCTION runByFile(argv): number                  // `--by-file` mode (per-site identity detail)
46:   unexempted = collectAllHits(resolveInputFiles(argv)).filter(h => NOT allowlist.matchesAstContext(h))   // same input contract (Critical 2)
47:   FOR h IN sortByFileThenLine(unexempted) PRINT `${h.file}:${h.line}:${h.subkind}  ${h.contextSnippet}`
48:   RETURN 0                                         // stable per-site IDs consumed by slice Major-4 closure + P33 §2A.4 gate; shares runCount's detection so a hit counted is a hit listed
```

## Test gate (REQ-012.3) — over test files (§8.1)

```
50: FUNCTION runTestGate(): number
51:   allowlist = parseAllowlist(...)    // shares the central artifact; named characterization tests only
52:   hits = []
53:   FOR file IN testFilesUnder('packages/agents/src')
54:     ast = parse(file)
55:     hits += construct_GenerateContentResponse(ast)   // raw import, `as GenerateContentResponse`, {candidates:[{content:{role,parts}}]} fixtures
56:     hits += mockResponseToChunk_geminiFixtures(ast)   // {candidates:...} stream builders
57:   named = ['boundaryRecovery.test.ts','chatSession.thinking-toolcalls.repro.test.ts','switch-context.spec.ts', ...hookWireFixturesIfOQ1aKeepsWire]
58:   unexempted = hits.filter(h => h.file NOT IN allowlist.testAllowlist(named))
59:   RETURN unexempted.length === 0 ? 0 : 1
```

## Central allow-list artifact (REQ-012.2, OQ-17)

```
60: FORMAT (dev-docs/agents-neutral-gate-allowlist.md): per entry:
61:   - exact file path
62:   - permitted AST-context pattern (e.g. "toGeminiContents call whose result flows to target.contents passed to applyLLMRequestModifications and is reconverted via toIContents in the same function")
63:   - written justification (why this bounded exception exists)
64: RULE: an inline // gate-exempt comment grants NOTHING (line 23 uses AST-context match only).
65: RULE: a structural hit with no matching allow-list entry FAILS regardless of any inline comment.
66: EXPECTED entries at target state:
67:   - streamRequestHelpers.ts G3 hook-wire toGeminiContents adapter — IFF OQ-1a keeps the wire Gemini-shaped (AST-context-keyed, NOT file-level)
67a:  - core/hookWireAdapter.ts — the named external-wire mapping functions ONLY (AST-context-keyed; Major 3 — added P07, extended P13, finalized here)
68:   - api/event-types.ts, api/event-schema.ts — declared public usage type (committed §7A option (C))
69:   - the usageStatsToPublicUsageMetadata mapper module in eventAdapter.ts — the committed option-(C) boundary mapper
70:   - // NOTE: core/turnLogging.ts is NOT allow-listed — OQ-3t is COMMITTED NEUTRAL (turnLogging.ts must carry ZERO Gemini usage keys)
71:   - test allow-list: the named characterization tests (line 57)
```

## Scope caveat (OQ-8 / REQ-007.3)

```
72: // The agents gate is scoped to packages/agents/src. It CANNOT enforce the core-owned
73: //   ServerUsageMetadataEvent (packages/core/src/core/turn.ts:221-228). REQ-007.3 states this limitation.
74: //   A separate core-package check is OUT OF SCOPE for #2349 unless preflight elects to add it.
```

## Integration Points

- The core gate wires into CI (`.github/workflows/ci.yml`) as a new npm script; the existing `scripts/genai-import-inventory.ts` shrink-ratchet stays (agents baseline → 0).
- The gate runs against the FINAL neutralized tree; it is the mechanical proof of acceptance §9.1-2/-2a/-2b/-10.

## Anti-Pattern Warnings

```
[ERROR] DO NOT: implement checks as bare-name grep — false-positives on ContentBlock/ToolDeclaration/JsonSchema/domain candidates.
[ERROR] DO NOT: grant exemptions via inline comments — central allow-list only (OQ-17).
[ERROR] DO NOT: exempt streamRequestHelpers.ts:281 (telemetry) when exempting :228 (hook wire) — AST-context, not file-level.
[ERROR] DO NOT: loosen any lint/complexity rule or add suppression directives to make the gate pass — fix the code.
[OK] DO: emit a clear per-hit message with file + AST context + reason.
```
