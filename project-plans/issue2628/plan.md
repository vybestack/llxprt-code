# Issue #2628 — Plan: unblocked residual slice (gate lands after #2763)

Issue: vybestack/llxprt-code#2628 (part of #2614, "lands last")
Branch: `issue2628` from main @ `5bedbd2385b8c4767e97c43d52b563d11e3b03db`
Date: 2026-09-16

## Sequencing analysis (binding constraints from the issue and its comments)

The issue's headline deliverable — the permanent structural gate
(`scripts/check-gemini-containment.ts`) plus retirement of the entire allowlist
apparatus — **cannot land now**:

1. Issue comment (acoliver, 2026-07-27, from #2730): "this structural gate must
   follow #2763." #2763 (extract Gemini provider into `plugins/google-gemini`)
   is open; its hard prerequisite #2762 is open; `plugins/` does not exist.
2. The updated Layer-1 endpoint requires "exactly one declaration in
   plugins/google-gemini" — unsatisfiable before #2763 lands.
3. Guard retirement requires differential negative-control parity of a
   replacement that PASSES on main. Test relocation is owned by #2762/#2763
   (same comment), so a zero-exemption naming gate cannot pass on main yet.
4. The issue says to consume #3421's policy-ready artifact; #3421 is open and no
   artifact exists in-repo.

Therefore this PR delivers the issue's **live residuals that this issue owns
and that are not reassigned or blocked**. The issue stays open; the gate, its
fixtures, and apparatus retirement land after #2763/#3421 unblock them.

## Ownership map used for scoping

| Work | Owner | Status for this PR |
|---|---|---|
| Model predicates `isGemini2Model`/`isGemini3Model` move | #2628 | IN SCOPE |
| `geminiContent.ts`/`ContentConverters` obsolete Gemini-direction surface | #2628 (#2624 precondition satisfied per 2026-09-16 comment; PR #3689 merged) | IN SCOPE |
| Dead `core/src/utils/messageInspectors.ts` | #2628 (obsolete Gemini-shaped surface, zero importers) | IN SCOPE |
| `contentGenerator.ts` `geminiApiKey` binding (keep GEMINI_API_KEY behavior) | #2628 | IN SCOPE |
| `ignore.ts` `geminiignorePath` rename (keep `.geminiignore` literal) | #2628 | IN SCOPE |
| `ContextSummaryDisplay.tsx` `geminiMdFileCount` rename | #2628 | IN SCOPE |
| `providerModelResolver.ts`/cli `config.ts` `envGeminiModel` renames | #2628 | IN SCOPE |
| `GeminiPrivacyNotice.tsx` provider-neutralization | #2628 | IN SCOPE |
| `backendMetrics.ts` `extractGeminiTokens` characterization/disposition | #2628 | IN SCOPE |
| `providerRequestConversion.ts` gemini dump branches behind provider boundary; barrel export removal | #2628 | IN SCOPE |
| `DirectMessageProcessor.ts` `_extractDirectGeminiOverrides`/`geminiDirectOverrides` neutral rename | #2628 (naming residual left by landed #2624) | IN SCOPE |
| Incidental non-provider test-binding renames (core/cli/settings test locals) | #2628 ("related test bindings/fixtures" row) | IN SCOPE |
| Naming-allowlist exemption removal for migrated sites (+ stale entries) | #2628 | IN SCOPE |
| Stale two-manifest-bridge comment in `scripts/genai-enclave/config.ts`; stale doc claims | #2628 | IN SCOPE (minimal correction) |
| New gate script, wiring, apparatus retirement | #2628 | BLOCKED on #2763 + #3421 artifact |
| Gemini alias/test-suite relocation (`aliasProviderFactory`, `builtinContributions`, oauth/provider-switch suites) | #2762/#2763 (reassigned by 2026-07-27 comment) | OUT |
| `Legacy*` bridges (`partUtils`, `toolDeclaration`) | #3694 | OUT |
| Hook DTO/finish-reason wire | #2624 (landed, PR #3689) | DONE |
| `GEMINI_API_KEY`/`GEMINI_MODEL`/`GEMINI_SYSTEM_MD` env forms, `gemini` provider id, `GEMINI.md`/`.geminiignore`/ecosystem filenames, `gemini_content`/`MessageType.AI='gemini'` wire values | permanent compat | PRESERVE |

## In-scope acceptance criteria (this PR)

1. `isGemini2Model`/`isGemini3Model` move from `packages/core/src/config/models.ts`
   into the Gemini provider implementation tree (`packages/providers/src/gemini/`)
   with direct owner imports; core exports deleted; their unit test relocates to
   the provider tree (bun test); no re-export bridges; `core/test/models`
   fixture references characterized and neutralized where they are incidental.
2. Obsolete Gemini-direction converter surface deleted: `toGeminiContent`/
   `toGeminiContents` and private Gemini-direction helpers removed from
   `ContentConverters`; `geminiContent.ts` reduced to the type surface still
   required by the LIVE neutral parse direction (`toIContent`/`toIContents`,
   used by `geminiResponseMapper`, history/session loading and its tests); the
   `llm-types/index.ts` barrel line removed only for deleted symbols; tests for
   deleted behavior removed with it, tests for preserved behavior retained.
3. `core/src/utils/messageInspectors.ts` deleted (zero importers) plus any
   orphaned test.
4. `contentGenerator.ts`: `geminiApiKey` local binding renamed neutral;
   `GEMINI_API_KEY` env-passthrough behavior unchanged (tests prove it).
5. Renames, behavior-identical: `ignore.ts::geminiignorePath` (literal
   `.geminiignore` unchanged), `ContextSummaryDisplay.tsx::geminiMdFileCount`
   (+ all callers), `providerModelResolver.ts::envGeminiModel` and cli
   `config.ts::envGeminiModel` (+ passing sites),
   `DirectMessageProcessor.ts::_extractDirectGeminiOverrides`/`geminiDirectOverrides`
   (characterize the DTO key first; if it is a wire value consumed elsewhere,
   rename only the private method and local binding and record the key as
   compat data in the census).
6. Incidental non-provider test-binding renames where characterization proves
   they are local test identifiers, not compat wire values or settings keys:
   `memoryDiscovery.test.ts` `*GeminiFile` locals, `cli.test.tsx::
   originalEnvGeminiSandbox`, `App.*.test.tsx::getAllGeminiMdFilenames` (5
   files), settings `canonicalProfileRepair*` `corruptCanonicalProfileNonGeminiModel`,
   `ignorePatterns.test.ts::getCurrentGeminiMdFilename`. Any binding that turns
   out to be a persisted settings key/wire value is PRESERVED and recorded in
   the census instead.
7. `GeminiPrivacyNotice.tsx` deleted; its consent content is presented through
   the existing provider-parameterized presentation (extend
   `MultiProviderPrivacyNotice`'s provider record or equivalent existing
   pattern); `PrivacyNotice.tsx` updated; `'gemini'` id literals preserved;
   consent/auth behavior preserved (existing privacy tests updated, assertions
   ported not deleted).
8. `backendMetrics.ts`: `extractGeminiTokens`/`geminiTokens` characterized
   against actual chunk types; deleted if proven dead, otherwise moved behind
   the provider-owned boundary with dispatch; census records callers + evidence.
9. `providerRequestConversion.ts`: `buildGeminiDumpContents`/
   `isGeminiCompatibleProvider`/`convertHistoryToGeminiFormat` import moved so
   the Gemini dump conversion is owned by the Gemini implementation tree with
   direct owner imports (neutral module keeps provider-id dispatch only if
   needed); `providers/src/index.ts` barrel export of `buildGeminiDumpContents`
   removed (zero external consumers; shrink-only).
10. Naming allowlist (`providerAgnosticNamingAllowlist.ts`) and any genai-enclave
    exemption entries for sites migrated in this PR are removed; stale entries
    whose sites no longer exist (e.g. `ProviderManager.ts::geminiProvider`)
    removed; `bun scripts/check-genai-enclave.ts` and
    `npm run gate:agents-neutral` and `providerAgnosticNaming` tests stay green.
11. `scripts/genai-enclave/config.ts` two-manifest-bridge comment corrected to
    the landed dependency absence; no other doc rewrites (the gate PR owns
    those).
12. Census (`census.md`) finalized: every current finding mapped to owner,
    disposition, and (for this PR's items) the passing test/guard evidence.

## Boundary cases (must hold)

- No dependency, manifest, or CI-workflow changes in this PR.
- All env/filename/provider-id/wire compat forms listed in the ownership map
  stay byte-identical.
- `GOOGLE_API_KEY`/`GOOGLE_CLOUD_PROJECT` untouched.
- No envelope-shape behavior changes; existing guards keep passing.
- No new `.js` files, no vitest/node tests; TS + bun test only.
- No re-export bridges, aliases, or forwarding wrappers for anything deleted.
- Every deleted test's still-meaningful assertions are ported, not dropped.

## Verification (per landing discipline)

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, `bun scripts/check-genai-enclave.ts`,
`npm run gate:agents-neutral`, and smoke
`bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"`
all pass on the PR head.

Long foreground commands get SIGTERM'd by a watchdog around ~130s: run the
suite with `nohup ... &` inside the repo's gitignored `tmp/` log path and poll.

## Scope expansion (2026-09-17, Andrew's explicit instruction)

The PR must CLOSE #2628, not make progress on it. Therefore this effort completes every open issue in #2628's hard dependency closure set, in order:

1. **#2759** (open; prereq #2758 closed): non-workspace plugin topology. Reserve `plugins/google-gemini` + `plugins/google-mcp-auth` outside root workspaces/lock; per-plugin manifest/lockfile/build/typecheck/test/pack flows; host-contract peer deps; root installs pull no plugin-only Google deps; release automation with explicit first-party plugin list + deterministic publication order; issue-2603 artifact tests extended for base-only / base+Gemini / base+MCP-auth installs; npm and Bun tested in separate contexts (plain `bun install`).
2. **#2762** (open; prereqs #2758 closed, #2759 done here): Gemini behavioral/property suites live in `plugins/google-gemini` with an explicit test-only source path (no production cross-dependency); coverage matrix: aliases/auth modes, streaming/non-streaming, tools, signatures/thinking, media/code, usage/finish/errors, models, runtime/config injection, abort, dumps; root + plugin suites green; no test removed before plugin-context equivalent runs.
3. **#2763** (open; prereq #2762 done here): Gemini production code moves into `plugins/google-gemini`; plugin manifest contributes provider `gemini`, built-in alias, alias-aware factory; hard-coded Gemini factory/switch and base `gemini.config` deleted; base lists do not advertise absent Gemini; selected Google generation SDK declared ONLY by the plugin; base works without the plugin; requested-but-absent Gemini and malformed/missing configured plugins fail actionably without fallback; bundle/release/boundary tests prove base excludes plugin source; API-key + Vertex behavior preserved; plugin suite passes.
4. **#2628 remainder**: the permanent structural gate (Layers 1-3 + envelope rule, zero-allowlist, report mode) with the endpoint from Andrew's #2628 comment (Layer 1: zero SDK declarations in base/root/providers + exactly one in plugins/google-gemini; Layer 2: SDK imports only in the non-workspace plugin); committed differential negative-control parity artifacts covering every meaningful retired-guard assertion (runtime/type-only/dynamic/require × production/test/packed, inapplicable cells justified) per #3421's guard-retirement contract (#3421 itself stays open; its contract is consumed, not its completion); wire gate into package.json/CI/tsconfig.scripts.json; delete the old apparatus (scripts/genai-enclave/** + check-genai-enclave.ts, agents-neutral-gate* family, genai-import-inventory, packages/agents naming scanner/allowlist/tests, baseline docs); port meaningful tests; rewrite boundary docs.

PR #3702 body gains closing keywords for #2628, #2763, #2762, #2759 when the final head is green. StepFun smoke requirements in old issue text are satisfied by the zai-glm-flash smoke (StepFun subscription cancelled 2026-09-13).
