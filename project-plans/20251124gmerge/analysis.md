# Cherry-Pick Analysis: gemini-cli v0.9.0 to v0.10.0

**Analysis Date:** 2025-11-24
**Total Commits:** 135
**Analyzed By:** Codex (llxprt-code assistant)

## Executive Summary

This review covers all 135 upstream commits landed between v0.9.0 and v0.10.0 (2025-10-08 → 2025-10-22). The window contains a mix of shell/IDE reliability work, MCP tooling fixes, UI polish, doc churn, release administration, and a handful of Gemini-specific features that conflict with llxprt’s multi-provider roadmap.

### Key Findings

- **Recommended to PICK:** 64 commits that directly improve CLI stability, IDE parity, MCP tooling, test coverage, or UI polish without conflicting with llxprt customizations.
- **Recommended to PICK CAREFULLY:** 6 commits introduce new defaults or major flows (interactive shell defaults, invalid-stream retries, `.gemini` path refactors, prompt changes) and need llxprt-specific review/testing.
- **Recommended to SKIP:** 65 commits (release management, telemetry, Gemini-only features, temporary test disables, A2A publishing plumbing, doc-only edits, and stylistic churn) do not add value or conflict with llxprt’s privacy/multi-provider stance.
- **High-value themes:** Windows shell/IDE stability, deterministic tooling retries, better MCP diagnostics, UI accessibility (screen readers, trust dialog UX), and extension management fixes.

### Critical Compatibility Notes

1. **Model Router & Auto-Retry Defaults:** Upstream now prefers `useModelRouter` and certain auto-retry behaviors by default. llxprt must keep model choice explicit; treat these commits carefully.
2. **CodebaseInvestigator/Subagent Paths:** Upstream doubled down on their CodebaseInvestigator stack. llxprt has its own subagent design—skip those commits entirely.
3. **Telemetry Remains Disabled:** Several commits add Clearcut/OpenTelemetry hooks. llxprt removed telemetry for privacy, so keep those changes out.
4. **A2A Publishing Workflows:** Multiple commits only affect the upstream a2a-server release pipeline. They are irrelevant for our fork unless we plan to ship that workflow separately.
5. **System Prompt Adjustments:** Upstream tweaked system instructions and workflow examples. Vet those changes carefully against llxprt’s CLAUDE.md guidance before enabling.

---

## Commits to PICK (64 commits)

| SHA | Date | Description | Reasoning |
|-----|------|-------------|-----------|
| 4f5b33579 | 2025-10-14 | fix(tests): enable cyclic schema MCP tool test (#10912) | Keeps MCP coverage aligned with real behavior; avoids silent regressions in schema discovery. |
| dabe161a6 | 2025-10-14 | Don't accept input until slash commands are loaded (#11162) | Prevents early keystrokes from being dropped when slash commands finish loading slowly. |
| 6f0107e7b | 2025-10-14 | fix(core): implement robust URL validation in web_fetch tool (#10834) | Hardens `web_fetch` against malformed URLs, improving multi-provider security guarantees. |
| 0a3e492e6 | 2025-10-14 | Integration test for UI flickers (#11067) | Adds regression coverage for flicker issues surfaced in IDE mode. |
| 99c7108bb | 2025-10-14 | fix integration test static errors, and run_shell_command tests to actually be testing what they intend (#11050) | Ensures shell tooling tests validate the real behavior rather than passing accidentally. |
| 7c1a90244 | 2025-10-14 | fix(core): add retry logic for specific fetch errors (#11066) | Improves resiliency of outbound fetches (e.g., MCP calls) without changing provider semantics. |
| c86ee4cc8 | 2025-10-14 | feat: Support Alt+key combinations (#11038) | Adds accessibility shortcuts used by IDE clients; llxprt should keep parity here. |
| 7b06a0beb | 2025-10-14 | fix(e2e): Use rmSync instead of rm -rf for e2e tests (#11087) | Avoids platform-specific failures in filesystem e2e tests. |
| 9e8c76769 | 2025-10-14 | fix(cli): record tool calls in non-interactive mode (#10951) | Preserves tool-call transcript metadata for audits even when running scripted sessions. |
| b2ba67f33 | 2025-10-14 | fix: Exit app on pressing esc on trust dialog at launch (#10668) | UX polish—developers can dismiss the initial trust dialog with ESC across providers. |
| a3fe9279d | 2025-10-14 | fix(compression): prevent unnecessary summarization when history is too short (#11082) | Avoids lossy compression when chats are already short; protects context quality. |
| 6787d42de | 2025-10-13 | perf(core): optimize Windows IDE process detection from O(N) to O(1) (#11048) | Major IDE startup speedup on Windows, which llxprt supports. |
| f56a561f0 | 2025-10-13 | Fix and unskip flakey integration test in replace.test.ts (#11060) | Restores coverage for replace flows to catch regressions. |
| dd01af609 | 2025-10-13 | refactor: set max retry attempts to 3 (#11072) | Caps retries consistently, preventing infinite loops with flaky providers. |
| ada179f57 | 2025-10-13 | bug(core): Process returned function calls sequentially. (#10659) | Ensures tool-returned function calls are serialized to avoid race conditions. |
| c4bd75946 | 2025-10-13 | document all settings with showInDialog: true (#11049) | Keeps settings dialog metadata accurate so llxprt users see the full set of toggles. |
| 4a5ef4d9f | 2025-10-13 | fix(infra) - Fix flake for file interactive system (#11019) | Stabilizes interactive filesystem tests; mirrors llxprt’s custom file loaders. |
| 7beaa368a | 2025-10-14 | refactor(core): use assertConnected in McpClient discover method (#10989) | Adds defensive checks so MCP discovery fails fast when the client disconnects. |
| 28e667bd9 | 2025-10-13 | Give explicit instructions for failure text in json-output.test.ts (#11029) | Clarifies test expectations for JSON output, reducing false positives. |
| 5dc7059ba | 2025-10-11 | Refactor: Introduce InteractiveRun class (#10947) | Cleans up interactive test harness so future fixes (including ours) are simpler. |
| 09ef33ec3 | 2025-10-10 | fix(cli): prioritize configured auth over env vars in non-interactive mode (#10935) | Honors explicit auth configuration—a must for llxprt’s multi-provider flows. |
| cd9193466 | 2025-10-10 | Clean up integration test warnings. (#10931) | Keeps CI noise down and highlights real failures. |
| ead8928c3 | 2025-10-10 | Deflake test. (#10932) | Removes a known flaky expectation; prevents noise during cherry-pick batches. |
| 265d39f33 | 2025-10-10 | feat(core): improve shell execution service reliability (#10607) | Strengthens shell tool execution, reducing “hung” tool calls in long sessions. |
| a64bb433b | 2025-10-10 | Simplify auth in interactive tests. (#10921) | Makes it easier to run auth-sensitive tests under llxprt’s provider switching. |
| a6e00d918 | 2025-10-10 | Fix rough edges around extension updates (#10926) | Addresses extension lifecycle bugs we’ve also seen reported by llxprt users. |
| bf0f61e65 | 2025-10-10 | Show final install path in extension consent dialog and fix isWorkspaceTrusted check (#10830) | Improves transparency and trust prompts when installing extensions. |
| ab3804d82 | 2025-10-10 | refactor(core): migrate web search tool to tool-names (#10782) | Aligns tool naming with shared registry, reducing confusion in multi-provider mode. |
| 0a7ee6770 | 2025-10-10 | Show notification in screen reader mode (#10900) | Accessibility improvement that llxprt IDE users expect. |
| 2a7c71667 | 2025-10-10 | Reenable NPM integration tests (#10623) | Restores tests that cover package-install workflows. |
| c6af4eaa0 | 2025-10-10 | fix: Usage of folder trust config flags in FileCommandLoader (#10837) | Makes folder trust respect CLI flags—important for enterprise customers. |
| 249ea5594 | 2025-10-10 | fix(test): Fix flaky shell command test using date command (#10863) | Eliminates locale-dependent failure in our shared shell tests. |
| affd3cae9 | 2025-10-10 | fix: Prevent garbled input during "Login With Google" OAuth prompt on… (#10888) | Keeps Google auth prompts readable; also helps other providers by analogy. |
| 8dc397c0a | 2025-10-10 | fix(core): set temperature to 1 on retry in sendMessageStream (#10866) | Forces retries to explore alternate completions instead of looping with same temperature. |
| 971eb64e9 | 2025-10-10 | fix(cli) : fixed bug #8310 where /memory refresh will create discrepancies… (#10611) | Keeps `/memory` state consistent after refresh, avoiding provider desync. |
| 558be8731 | 2025-10-09 | Re-land bbiggs changes to reduce margin on narrow screens with fixes + full width setting (#10522) | UI polish that also benefits our responsive CLI panels. |
| cce245738 | 2025-10-09 | Fix for race condition in extension install / uninstall logging (#10856) | Prevents duplicate logs and ensures telemetry-free logging remains accurate. |
| fda3b5435 | 2025-10-09 | chore(int): disable skip on "should trigger chat compression with /co…" (#10854) | Re-enables the compression test so regressions surface quickly. |
| 21062dd30 | 2025-10-09 | clean up extension tests (#10857) | General cleanup that makes the suite easier to run locally. |
| ed37b7c5e | 2025-10-09 | fix some isWorkspaceTrusted mocks (#10836) | Fixes incorrect mocks so trust-related unit tests reflect reality. |
| 5aab793cf | 2025-10-09 | fix(infra) - Fix interactive system error (#10805) | Removes a failure mode where infrastructure tests errored on startup. |
| 5e688b811 | 2025-10-09 | Skip should fail safely when old_string is not found test (#10853) | Ensures the skip tool emits a friendly failure when strings are absent. |
| 5f96eba54 | 2025-10-09 | fix(cli): prevent exit on non-fatal tool errors (#10671) | Prevents the CLI from shutting down when a single tool fails; critical for long runs. |
| a8379d1f4 | 2025-10-09 | fix(tests): enable and update prompt for MCP add tool test (#10850) | Keeps MCP add-tool flows validated end-to-end. |
| 6d84d4dc9 | 2025-10-09 | Fix prompt to make it a bit more deterministic (#10848) | Reduces randomness in prompts used by automated tests. |
| ae02236c6 | 2025-10-09 | feat(core): generalize path correction for use across tools (#10612) | Centralizes path normalization so every tool (including llxprt’s) benefits. |
| 433ca84ce | 2025-10-09 | fix(tests): log actual output in validateModelOutput on failure (#10843) | Improves diagnostics when a model output test fails. |
| cd354aebe | 2025-10-09 | Fix hooks to avoid unnecessary re-renders (#10820) | Reduces UI recomputation, making the CLI more responsive. |
| b60c8858a | 2025-10-09 | feat(ui): shorten context overflow message when <50% of limit (#10812) | Friendlier warning copy that fits llxprt’s UI constraints. |
| a044c2598 | 2025-10-08 | fix: Add a message about permissions command on startup in untrusted … (#10755) | Reminds users about `permissions` when running from an untrusted folder. |
| 3d2457523 | 2025-10-09 | refactor(core): Centralize 'write_file' tool name (#10694) | Keeps tool naming consistent across providers; simplifies our overrides. |
| 06920402f | 2025-10-08 | feat(core): Stop context window overflow when sending chat (#10459) | Prevents accidental context overflow tickets by checking before send. |
| 29aabd7bf | 2025-10-08 | Remove 'hello' extension (#10741) | Removes outdated sample extension that confuses users. |
| 741b57ed0 | 2025-10-08 | fix(core): Use shell for spawn on Windows (#9995) | Fixes Windows shell command behavior for IDE workflows. |
| 76b1deec2 | 2025-10-08 | fix(core): refresh file contents in smart edit given newer edits (#10084) | Ensures Smart Edit sees the latest file contents before applying diff hints. |
| f2852056a | 2025-10-08 | feat: prevent ansi codes in extension MCP Servers (#10748) | Sanitizes ANSI codes so extension MCP traffic stays parseable. |
| 1962b51d8 | 2025-10-09 | fix: ensure positional prompt arguments work with extensions flag (#10077) | Restores CLI parity when extensions are invoked with positional args. |
| b92e3bca5 | 2025-10-09 | fix(mcp): fix MCP server removal not persisting to settings (#10098) | Eliminates an MCP settings persistence bug we also see in llxprt. |
| 603ec2b21 | 2025-10-08 | Add script to deflake integration tests (#10666) | Gives us a shared deflake helper for repeated cherry-pick verifications. |
| 1af3fef33 | 2025-10-08 | fix(infra) - Remove auto update from integration tests (#10656) | Stops auto-update prompts from failing integration tests mid-run. |
| 8aa730082 | 2025-10-08 | refactor(core): Centralize 'write_todos_list' tool name (#10690) | More consistent todo-tool naming; necessary for llxprt’s todo extensions. |
| 8ac2c6842 | 2025-10-08 | chore: bundle a2a-server (#10265) | Adds bundler support for the a2a-server workspace, which llxprt ships. |
| 8980276b2 | 2025-10-08 | Rationalize different Extension typings (#10435) | Cleans up extension types so downstream TypeScript code remains correct. |
| 5d09ab7eb | 2025-10-08 | chore: refactored test-helper to handle boilerplate for interactive mode (#10322) | Simplifies future test additions by centralizing interactive setup code. |

## Commits to PICK CAREFULLY (6 commits)

| SHA | Date | Description | Reasoning |
|-----|------|-------------|-----------|
| 467a305f2 | 2025-10-08 | chore(shell): Enable interactive shell by default (#10661) | Changes the default shell behavior; verify it doesn’t surprise llxprt users or conflict with our sandboxing defaults before enabling. |
| 0b6c02000 | 2025-10-09 | feat(core): Failed Response Retry via Extra Prompt (#10828) | Adds automatic “Please continue.” retries plus a new config flag—great for resiliency, but make sure it doesn’t mask provider-specific error modes or reintroduce hidden retries. |
| ae48e964f | 2025-10-10 | feat(ui): add flicker detection and metrics (#10821) | Provides flicker detection plus telemetry hooks; we should adopt the detection logic but strip/replace telemetry plumbing. |
| 518caae62 | 2025-10-14 | chore: Extract '.gemini' to GEMINI_DIR constant (#10540) | Large path refactor that assumes `.gemini/`—adapt it so the constant points at `.llxprt/` and update our branding-sensitive tests. |
| 249a193c0 | 2025-10-13 | Update system instructions for optimizing shell tool commands (#10651) | Modifies the core system prompt; review carefully so llxprt’s CLAUDE.md guidance and provider-agnostic metaphors stay intact. |
| 3ba4ba79f | 2025-10-14 | Remove workflow examples from system instruction (#10811) | Removes upstream workflow examples; make sure llxprt still gives users enough context and doesn’t break our documentation references. |

## Commits to SKIP (65 commits)

### Release Management & Version Bumps (12 commits)
| SHA | Date | Description | Reasoning |
|-----|------|-------------|-----------|
| 5eb56494e | 2025-10-22 | chore(release): v0.10.0 | Upstream version tag; no code changes required in llxprt. |
| 5d92b507b | 2025-10-22 | chore(release): v0.10.0-preview.4 | Gemini release metadata only. |
| cbb5e3933 | 2025-10-21 | fix(patch): cherry-pick 5b750f5… preview.3 (#11625) | Patch build applied to release branches; underlying fixes are captured elsewhere. |
| 845471ea0 | 2025-10-21 | chore(release): v0.10.0-preview.3 | Version bump only. |
| f35e24177 | 2025-10-21 | fix(patch): cherry-pick 8aace3a… preview.2 (#11595) | Release hotfix; we’ll take the original fix commits directly. |
| 076123e31 | 2025-10-17 | chore(release): v0.10.0-preview.2 | Release metadata. |
| a18608386 | 2025-10-17 | fix(patch): cherry-pick 0ded546… preview.1 (#11415) | Patch branch plumbing; redundant once we cherry-pick real fixes. |
| fa1097dfe | 2025-10-16 | chore(release): v0.10.0-preview.1 | Release metadata. |
| a6311e3c4 | 2025-10-16 | fix(patch): cherry-pick 5aaa0e6… preview.0 (#11287) | Another release hotfix; skip and carry the source commits. |
| 0e79bd400 | 2025-10-15 | chore(release): v0.10.0-preview.0 | Release metadata. |
| 95268b266 | 2025-10-08 | chore(release): bump version to 0.10.0-nightly… (#10669) | Nightly bump; no product code. |
| 56ca62cf3 | 2025-10-08 | Pre releases (#10752) | Same as above. |

### CI / Infra Adjustments (4 commits)
| SHA | Date | Description | Reasoning |
|-----|------|-------------|-----------|
| cb1ec755f | 2025-10-15 | fix(ci): Move from self-hosted -> ubuntu-latest (#11205) | Gemini-specific CI migration; llxprt already runs on its own infrastructure. |
| 984415f6c | 2025-10-15 | feat(ci): Update release to use github env variables. (#11068) | Touches their GitHub Actions release flow only. |
| 90de8416c | 2025-10-13 | Swap all self-hosted runners to ubuntu-latest per b/451586626 (#11023) | Same as above—CI plumbing not reused downstream. |
| 112790cba | 2025-10-10 | fix(infra) - Create a step to calculate the inputs for the nightly-release (#10825) | Automation for Gemini nightly jobs that llxprt doesn’t run. |

### Documentation-only Updates (14 commits)
| SHA | Date | Description | Reasoning |
|-----|------|-------------|-----------|
| 0dea35445 | 2025-10-15 | Add a GH Issue template for a website issue… (#10923) | Gemini website template; llxprt tracks issues separately. |
| 203bad7c0 | 2025-10-15 | Docs: Point to extensions gallery… (#10763) | Gemini-specific docs. |
| 0f8199dde | 2025-10-13 | fix(site): Fix broken site link (#11079) | Applies to the upstream marketing site. |
| 20fc7abc8 | 2025-10-13 | Docs: Quick fix: Sidebar link. (#11065) | Docs change only. |
| 19c1d7340 | 2025-10-13 | add bundle command info to integration test docs (#11034) | Internal doc update; llxprt docs need a different voice. |
| 37678acb1 | 2025-10-10 | Update deployment.md -> installation.md and sidebar links. (#10662) | Gemini doc restructure. |
| a5e47c62e | 2025-10-10 | Docs: Update to tos-privacy.md (#10754) | Gemini ToS update, not relevant downstream. |
| 849cd1f9e | 2025-10-10 | Docs: Fix Flutter extension link… (#10797) | External doc fix. |
| 65b9e367f | 2025-10-10 | Docs: Fix broken links in architecture.md (#10747) | Architecture doc text only. |
| bd6bba8d0 | 2025-10-09 | fix(doc) - Update doc for deflake command (#10829) | Documentation cleanup. |
| 8d8a2ab64 | 2025-10-08 | Fix(doc) - Add section in docs for deflaking (#10750) | Documentation only. |
| 3d106186f | 2025-10-08 | Docs: Add updates to changelog for v0.8.0 (#10732) | Upstream changelog entry. |
| 118aade84 | 2025-10-08 | citations documentation (#10742) | Doc addition that references Gemini programs. |
| bcbcaeb82 | 2025-10-08 | fix(docs): Update docs/faq.md per Srinanth (#10667) | FAQ update not applicable to llxprt. |

### Telemetry & Data Collection (6 commits)
| SHA | Date | Description | Reasoning |
|-----|------|-------------|-----------|
| 38bc85621 | 2025-10-10 | feat(telemetry): ensure all telemetry includes user email… (#10897) | More telemetry plumbing; llxprt intentionally removed it. |
| 83075b280 | 2025-10-09 | refactor: make log/event structure clear (#10467) | Massive telemetry refactor that reintroduces Clearcut-like flows. |
| 1f6716f98 | 2025-10-09 | feat(telemetry): add diff stats to tool call metrics (#10819) | Expands telemetry payloads—skip for privacy reasons. |
| 70610c740 | 2025-10-09 | feat(telemetry): Add telemetry for web_fetch fallback attempts (#10749) | Another telemetry-only change. |
| c0552ceb2 | 2025-10-08 | feat(core): add telemetry for subagent execution (#10456) | Relies on telemetry backend not present in llxprt. |
| 8cd2ec7c9 | 2025-10-08 | [Part 4/6] feat(telemetry): add memory monitor… (#8122) | Same rationale—collects data we don’t want to send. |

### A2A Server Publishing Plumbing (6 commits)
| SHA | Date | Description | Reasoning |
|-----|------|-------------|-----------|
| 8c78b62b7 | 2025-10-14 | fix: set a2a-server publish to --no-tag (#11138) | Gemini’s internal publishing flow; llxprt manages releases differently. |
| 481ba01c9 | 2025-10-14 | chore: resubmit a2a-publishing after rollout (#11100) | Retry-only change to their pipeline. |
| c23eb84b0 | 2025-10-13 | fix(remove private) from gemini-cli-a2a-server (#11018) | Packaging tweak for Google’s npm scope; not applicable downstream. |
| cfb71b9d6 | 2025-10-13 | chore: wire a2a-server up for publishing (#10627) | Same as above. |
| f3424844d | 2025-10-13 | Revert "chore: wire a2a-server up for publishing" (#11064) | Reverts the previous line of work; neither is needed. |
| c82c2c2b1 | 2025-10-10 | chore: add a2a server bin (#10592) | Adds an upstream-specific bin entry; llxprt already customizes bundling. |

### Subagent / Model Router / Google-specific Features (7 commits)
| SHA | Date | Description | Reasoning |
|-----|------|-------------|-----------|
| a2f3339a0 | 2025-10-14 | Enable Model Routing (#11154) | Forces “auto” model routing by default; llxprt keeps explicit provider choice. |
| ef3186d44 | 2025-10-14 | Enable codease investigator by default… (#11136) | Turns on CodebaseInvestigator (Gemini-only) that we don’t ship. |
| a6720d600 | 2025-10-14 | Make codebase investigator less prone… (#10655) | Another tweak to the investigator stack—skip for the same reason. |
| 9185f68e5 | 2025-10-13 | Expose Codebase Investigator settings to the user (#10844) | Adds settings UI we don’t surface. |
| 771627505 | 2025-10-13 | chore(settings): Enable 'useSmartEdit' by default (#11051) | Upstream wants Smart Edit on by default; llxprt keeps it opt-in. |
| 907e51ac0 | 2025-10-11 | Code guide command (#10940) | Adds a `.gemini`-specific command template; llxprt has different onboarding material. |
| 0cd490a9b | 2025-10-09 | feat: support GOOGLE_CLOUD_PROJECT_ID fallback… (#2725) | Purely Google-cloud env fallback, which conflicts with llxprt’s multi-provider auth model. |

### Temporary Test Disables & Deflake Toggles (8 commits)
| SHA | Date | Description | Reasoning |
|-----|------|-------------|-----------|
| 769fe8b16 | 2025-10-14 | Delete unworkable replace test and enabled the rest (#11125) | Deletes a test instead of fixing it; llxprt prefers keeping coverage. |
| 49b66733c | 2025-10-14 | fix(infra) - Disable CTRL-C test (#11122) | Disables a test we still rely on; we should keep debugging instead. |
| 061a89fc2 | 2025-10-14 | Disable retries when deflaking integration tests (#11118) | Test-only knob that hides flakes instead of fixing them. |
| 1e838393a | 2025-10-14 | Skip flakey tests (#11101) | Same rationale. |
| 32db4ff66 | 2025-10-10 | Disable flakey tests. (#10914) | Same rationale. |
| 3ea5581ad | 2025-10-08 | chore(int): disable flaky tests (#10771) | Same rationale. |
| b0b1be0c2 | 2025-10-08 | chore(int): skip flaky tests (#10736) | Same rationale. |
| b45bd5ff7 | 2025-10-08 | Fix(infra) - Skip file system interactive test… (#10734) | Skips a test instead of correcting the behavior; we want coverage. |

### Superseded / Interim Behavior Changes (5 commits)
| SHA | Date | Description | Reasoning |
|-----|------|-------------|-----------|
| 996c9f595 | 2025-10-14 | Revert "fix: handle request retries and model fallback correctly" (#11164) | Revert of a fallback commit we never imported; nothing to do. |
| bd5c158a6 | 2025-10-14 | Revert "Shell approval rework" (#11143) | Upstream reworked shell approval then reverted; we’re skipping the entire experiment. |
| 92dbdbb93 | 2025-10-14 | Shell approval rework (#11073) | Changes CLI approval semantics we don’t want to destabilize right now. |
| f68f27e7f | 2025-10-13 | Revert "feat: Support Alt+key combinations" (#11025) | Intermediate revert superseded by c86ee4cc8; no need to cherry-pick. |
| 87f175bb2 | 2025-10-12 | feat: Support Alt+key combinations (#10767) | First attempt at Alt-key support; the later c86ee4cc8 includes the final, fixed version. |

### Miscellaneous Low-value Changes (2 commits)
| SHA | Date | Description | Reasoning |
|-----|------|-------------|-----------|
| a73b81452 | 2025-10-13 | Rename expect methods. (#11046) | Pure naming churn; no functional change. |
| d190188aa | 2025-10-09 | Add a joke to usePhraseCycler.ts (#10685) | Adds whimsical output; llxprt keeps professional prompts. |

---

## Detailed Analysis Notes

- **Shell & Tool Reliability:** The combination of `265d39f33`, `5f96eba54`, `7c1a90244`, and `5e688b811` significantly improves how shell tools behave under failure. Apply them early to stabilize developer workflows.
- **MCP & Extension Parity:** MCP-specific fixes (`7beaa368a`, `a8379d1f4`, `b92e3bca5`, `4f5b33579`) plus extension lifecycle improvements (`a6e00d918`, `bf0f61e65`, `cce245738`, `21062dd30`) keep llxprt on parity with upstream IDE experiences.
- **UI & Accessibility:** UX wins such as `0a7ee6770`, `558be8731`, `b2ba67f33`, and `c86ee4cc8` reduce friction for screen reader and keyboard-only users.
- **Context Management:** Commits like `06920402f`, `a3fe9279d`, `8dc397c0a`, and `76b1deec2` protect the conversation history from unneeded compression or stale data.

## Recommended Cherry-Pick Order

1. **Phase 1 – Stability & Test Harness (Days 1‑2)**
   - Shell/tool resilience: `265d39f33`, `5f96eba54`, `7c1a90244`, `5e688b811`, `5aab793cf`.
   - Test harness fixes: `5d09ab7eb`, `603ec2b21`, `1af3fef33`, `f56a561f0`, `4f5b33579`, `99c7108bb`.
   - MCP & path refactors that don’t touch prompts: `7beaa368a`, `433ca84ce`, `1962b51d8`, `b92e3bca5`, `3d2457523`, `8aa730082`.

2. **Phase 2 – IDE/Extension/UX Enhancements (Days 3‑4)**
   - IDE/extension work: `6787d42de`, `a6e00d918`, `bf0f61e65`, `cce245738`, `21062dd30`, `8ac2c6842`.
   - UI/accessibility: `b2ba67f33`, `0a7ee6770`, `558be8731`, `c86ee4cc8`, `b60c8858a`.
   - Context/Smart Edit improvements: `06920402f`, `a3fe9279d`, `8dc397c0a`, `76b1deec2`.

3. **Phase 3 – Prompt/System-Level Adjustments (Days 5‑6)**
   - Non-interactive auth & logging: `09ef33ec3`, `9e8c76769`, `971eb64e9`, `249ea5594`.
   - Prompt/system tweaks (after review): `249a193c0`, `3ba4ba79f`, `0b6c02000`, `ae48e964f`, `518caae62`, `467a305f2`.

Run the quality checklist (format → lint → typecheck → test → build → synthetic profile) after each phase as described in AGENTS.md.

## Testing Requirements

- Unit + integration suites must pass (`npm run test`, plus targeted MCP/extension tests).
- Verify non-interactive auth flows with multiple providers after `09ef33ec3` and `/memory` after `971eb64e9`.
- Exercise IDE clients on Windows after `6787d42de`, `741b57ed0`, and `b2ba67f33`.
- Run at least one MCP OAuth server scenario after the MCP fixes.
- For pick-carefully commits, add bespoke manual runs (e.g., invalid stream recovery, interactive shell default) before merging.

## Risk Assessment

- **Low Risk:** Most picks are tight bug fixes or test-only improvements. Apply them in batches with the standard verification loop.
- **Medium Risk:** The six "pick carefully" commits touch defaults, prompts, or global paths. Schedule extra manual validation (multi-provider auth, Smart Edit compatibility, `.llxprt` directory handling) before landing them.
- **Skipped High Risk:** Telemetry additions, model-router defaults, CodebaseInvestigator work, and temporary test disables stay out to preserve llxprt’s privacy posture and multi-provider guarantees.

## Questions & Follow-ups

1. **Prompt Changes:** Confirm with product whether the streamlined workflow instructions (`249a193c0`, `3ba4ba79f`) match llxprt’s CLAUDE.md before enabling.
2. **Interactive Shell Default:** Decide whether llxprt wants to flip the default or expose it as a setting first (`467a305f2`).
3. **Telemetry Hooks:** If we ever reintroduce limited local telemetry, capture the flicker detector logic (`ae48e964f`) separately so it doesn’t depend on Clearcut.
