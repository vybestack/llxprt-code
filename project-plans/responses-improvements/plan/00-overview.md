# 00 – Overview: OpenAI Responses Improvements

This plan follows docs/PLAN.md (autonomous worker protocol) and docs/RULES.md (TDD-only, behavioral tests). It delivers corrections and enhancements to our OpenAI Responses API integration.

Scope
- Correct non-streaming /v1/responses parsing (REQ-001)
- Prefer server usage for accounting in streaming; always emit usage message (REQ-002)
- Reasoning rendering toggle and hardened detection (REQ-003)
- Clarify stateful handling with previous_response_id; remove unsupported fields (REQ-004)
- Opt-in to Responses via config for custom base URLs; env disable still wins (REQ-005)
- Configurable tool/JSON limits with soft warn + hard fail (REQ-006)
- Docs alignment and test coverage via behavioral tests per requirement (REQ-007..010)

Milestones
1) Phase 01 – Analysis artifacts complete
2) Phase 02 – Pseudocode for components 001..006 complete
3) Phase 03–05 (REQ-001): stub → TDD → implementation green
4) Phase 03–05 (REQ-002): stub → TDD → implementation green
5) Phase 03–05 (REQ-003): stub → TDD → implementation green
6) Phase 06+ (REQ-004..010): stub/TDD/impl batched or sequential as needed

Success Criteria
- All REQ-00X covered with behavioral tests (@requirement tags)
- No mock theater, no structure-only tests per docs/RULES.md
- >90% coverage on modified provider code; mutation score ≥80% for changed units
- Legacy Chat Completions behavior unchanged

TODOLIST
- [ ] PH01: Complete analysis/domain-model.md mapping behaviors to REQs
- [ ] PH02: Write pseudocode files 001..006 under analysis/pseudocode/
- [ ] PH03–05 REQ-001: Non-streaming parser – stub, TDD, impl, verif
- [ ] PH03–05 REQ-002: Usage-driven accounting – stub, TDD, impl, verif
- [ ] PH03–05 REQ-003: Reasoning toggle – stub, TDD, impl, verif
- [ ] PH06–08 REQ-004..006: Stateful, base-URL override, tool limits – stub/TDD/impl
- [ ] PH09–10 REQ-007..010: Docs updates, compatibility, logging – tests + impl

References
- docs/PLAN.md (phase structure, verification gates)
- docs/RULES.md (TDD, behavioral testing, immutability, strict TS)
- project-plans/responses-improvements/specification.md (REQ-001..010)
- analysis/pseudocode/*.md (component pseudocode)
