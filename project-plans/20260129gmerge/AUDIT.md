# Audit: v0.15.4 → v0.16.0 Cherry-Pick

**Branch:** `20260129gmerge`
**Upstream range:** `v0.15.4..v0.16.0`

---

## Reconciliation Table

| Upstream SHA | Decision | LLxprt Commit(s) | Notes |
|--------------|----------|------------------|-------|
| e8038c727 | PICK | | fix test to use faketimer |
| d3cf28eb4 | PICK | | Use PascalCase for tool display names |
| cab9b1f37 | PICK | | Fix extensions await handler |
| 1c8fe92d0 | PICK | | Hook Result Aggregation |
| 1c87e7cd2 | PICK | | RipGrep enhancements |
| 1ffb9c418 | PICK | | FileCommandLoader abort fix |
| 540f60696 | PICK | | Docs fix |
| 4d85ce40b | PICK | | console.clear() buffer fix |
| 0075b4f11 | PICK | | Tool internal name display |
| aa9922bc9 | PICK | | Keyboard shortcuts docs autogen |
| ad1f0d995 | PICK | | toml-loader test refactor |
| a810ca80b | PICK | | Reset to auto in fallback mode |
| 43916b98a | PICK | | Buffer cleanup fix |
| 13d8d9477 | PICK | | Editor setting immediate update |
| 11a0a9b91 | SKIP | N/A | clearcut-logger telemetry |
| 408b88568 | SKIP | N/A | clearcut telemetry |
| c961f2740 | SKIP | N/A | Version bump |
| 396b427cc | SKIP | N/A | Version bump |
| 570ccc7da | SKIP | N/A | code_assist metadata |
| 7ec78452e | SKIP | N/A | Different todo system |
| d26b828ab | SKIP | N/A | Gemini-specific model config |
| 2987b473d | SKIP | N/A | Gemini-specific model config |
| a05e0ea3a | SKIP | N/A | Version bump |
| 0f9ec2735 | SKIP | N/A | Already have useAlternateBuffer=true |
| 1ed163a66 | SKIP | N/A | Safety checker - security theater, sandbox is real protection |
| fe1bfc64f | SKIP | N/A | ASCII art branding |
| 102905bbc | SKIP | N/A | ASCII art normalization |
| 54c1e1385 | SKIP | N/A | Package lock only |
| 5d27a62be | SKIP | N/A | LLxprt keeps read-many-files |
| 48e3932f6 | SKIP | N/A | Gemini auth types |
| eb9ff72b5 | SKIP | N/A | Incremental update experiment |
| 1c6568925 | SKIP | N/A | Preview release |
| 3cb670fe3 | SKIP | N/A | Selection warning - LLxprt has /mouse off |
| ea4cd98e2 | SKIP | N/A | Preview release |
| cc608b9a9 | SKIP | N/A | Google A/B testing infra |
| 6f34e2589 | SKIP | N/A | Tied to selection warning |
| dcc2a4993 | SKIP | N/A | Preview release |
| a2b66aead | SKIP | N/A | Preview release |
| 47642b2e3 | SKIP | N/A | Preview patch |
| c9e4e571d | SKIP | N/A | Preview release |
| 670f13cff | SKIP | N/A | Preview release |
| 56f9e597c | SKIP | N/A | Gemini 3 launch branding |
| aefbe6279 | SKIP | N/A | Final release |
| ee7065f66 | REIMPLEMENT | | Sticky headers |
| fb99b9537 | REIMPLEMENT | | Header truncation |
| d30421630 | REIMPLEMENT | | Polish sticky headers |
| 3cbb170aa | REIMPLEMENT | | ThemedGradient usage sites |
| 60fe5acd6 | REIMPLEMENT | | Animated scroll keyboard |
| 2b8adf8cf | REIMPLEMENT | | Drag scrollbar |
| fb0324295 | REIMPLEMENT | | MALFORMED_FUNCTION_CALL handling |

---

## Summary

| Decision | Count |
|----------|-------|
| PICKED | 0 (of 14 planned) |
| REIMPLEMENTED | 0 (of 7 planned) |
| SKIPPED | 29 |
| NO_OP | 0 |

---

## Key Architectural Decisions

1. **Safety Checker Framework**: Permanently skipped. Focus on sandbox for real security.
2. **Selection Warning**: Skipped. LLxprt has `/mouse off` as alternative UX.
3. **Sticky Headers**: Reimplementing. User-requested feature.
