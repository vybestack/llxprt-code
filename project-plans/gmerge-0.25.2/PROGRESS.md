# Execution Progress: gemini-cli v0.24.5 → v0.25.2

Track batch execution here while following `PLAN.md`.

## Status Values

- `TODO`
- `DOING`
- `DONE`
- `SKIPPED`

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit | Notes |
| ----: | ---- | --------------- | ------ | ------------- | ----- |
| B1 | PICK | `da85e3f8f23 982eee63b61 a26463b056d 2d683bb6f8a` | DONE | `038c71bef` | feat(core): improve activate_skill tool and use lowercase XML tags; Hx support; Skills Foundation; Multi-scope skill enablement |
| B2 | REIMPLEMENT | `5fe5d1da467` | DONE | `75b9d97f2` | policy: extract legacy policy from core tool scheduler to policy engine |
| B3 | REIMPLEMENT | `416d243027d` | DONE | `e1c147aa4` | Enhance TestRig with process management and timeouts |
| B4 | PICK | `8f9bb6bccc6` | DONE | `6c7d9f5f9` | Update troubleshooting doc for UNABLE_TO_GET_ISSUER_CERT_LOCALLY |
| B5 | REIMPLEMENT | `97b31c4eefa` | DONE | `768253cf9` | Simplify extension settings command |
| B6 | PICK | `57012ae5b33` | DONE | `b46303b74` | Core data structure updates for Rewind functionality |
| B7 | REIMPLEMENT | `c64b5ec4a3a` | DONE | `8a58abd7c` | feat(hooks): simplify hook firing with HookSystem wrapper methods |
| B8 | REIMPLEMENT | `4c961df3136` | DONE | `a4b6dfa45` | feat(core): Decouple enabling hooks UI from subsystem |
| B9 | REIMPLEMENT | `17b3eb730a9` | DONE | `0f80e3619` | docs: add docs for hooks + extensions |
| B10 | PICK | `1bd4f9d8b6f d48c934357c 3e2f4eb8ba1 722c4933dc3` | DONE | `71a198932` | Optimize json-output tests; filepath autosuggestion; Skills UX polishing; Move skills warning to debug |
| B11 | REIMPLEMENT | `030847a80a4` | DONE | `7b271af05` | feat(cli): export chat history in /bug and prefill GitHub issue |
| B12 | REIMPLEMENT | `97ad3d97cba` | DONE | `deed5406a` | Reapply feat(admin): implement extensions disabled |
| B13 | REIMPLEMENT | `660368f2490` | DONE | `6b0624949` | bug(core): Fix spewie getter in hookTranslator.ts |
| B14 | REIMPLEMENT | `eb3f3cfdb8a` | DONE | `e882743f2` | feat(hooks): add mcp_context to BeforeTool and AfterTool hook inputs |
| B15 | PICK | `1a4ae413978` | SKIPPED | — | NO-OP: yolo redirect fix already present in LLxprt |
| B16 | PICK | `f8138262fa7 fbfad06307c 01d2d437372 e5f7a9c4240 4ab1b9895ad` | DONE | `ff9313d45` | disableYoloMode fix; Sublime Text IDE; Antigravity terminal; rewind FS reversion; TERM xterm-256color |
| B17 | REIMPLEMENT | `18dd399cb57` | DONE | `229ece80f` | Support @ suggestions for subagents |
| B18 | REIMPLEMENT | `e1e3efc9d04` | DONE | `482b5073d` | feat(hooks): Support explicit stop and block execution control in model hooks |
| B19 | REIMPLEMENT | `41e627a7ee4` | DONE | `f45f9f6ff` | Refine Gemini 3 system instructions to reduce model verbosity |
| B20 | PICK | `88f1ec8d0ae` | DONE | `80ff528c7` | Always enable bracketed paste |
| B21 | REIMPLEMENT | `77e226c55fe` | DONE | `2c1b33b8e` | Show settings source in extensions lists |
| B22 | PICK | `8bc3cfe29a6 c1401682ed0 14f0cb45389` | DONE | `fb79ec9e8` | pr-creator skill; Shift+Space Kitty; reduce home dir warning noise |
| B23 | REIMPLEMENT | `c7d17dda49d` | DONE | `ebd8e7aee` | fix: properly use systemMessage for hooks in UI |
| B24 | PICK | `ea7393f7fd5 e04a5f0cb0e 1fb55dcb2e0` | DONE | `21f8c93ec` | modifyOtherKeys inference; cache ignore instances; autogenerate settings docs |
| B25 | REIMPLEMENT | `b08b0d715b5` | DONE | `82da1fee9` | Update system prompt to prefer non-interactive commands |
| B26 | REIMPLEMENT | `461c277bf2d` | DONE | `7431b1f8b` | Support for Built-in Agent Skills |
| B27 | REIMPLEMENT | `0e955da1710` | DONE | `48098fcab` | feat(cli): add /chat debug command for nightly builds |
| B28 | PICK | `93b57b82c10` | SKIPPED | — | NO-OP: upstream formatted .gemini/skills path not in LLxprt |
| B29 | REIMPLEMENT | `9703fe73cf9` | DONE | `9209b0252` | feat(cli): Hooks enable-all/disable-all feature with dynamic status |
| B30 | PICK | `64c75cb767c` | DONE | `9a7c9eb3e` | Fix crash on unicode character |
| B31 | REIMPLEMENT | `950244f6b00` | DONE | `320eed1c1` | Attempt to resolve OOM w/ useMemo on history items |
| B32 | REIMPLEMENT | `8a2e0fac0d8` | DONE | `1bed4abf6` | Add other hook wrapper methods to hooksystem |
| B33 | PICK | `15891721ad0` | DONE | `fa7dc3f2e` | feat: introduce useRewindLogic hook |
| B34 | PICK | `64cde8d4395` | DONE | `ef85f6f7d` | fix(policy): enhance shell command safety and parsing |
| B35 | PICK | `3b678a4da0f 8437ce940a1 e049d5e4e8f` | DONE | `b7703e68b` | activate_skill re-registration; Revert extension examples; fastreturn support |
| B36 | PICK | `95d9a339966` | DONE | `3af99a975` | migrate yolo/auto-edit keybindings |
| B37 | PICK | `2e8c6cfdbb8` | DONE | `831bde6ac` | feat(cli): add install and uninstall commands for skills |
| B38 | PICK | `ca6786a28bd` | DONE | `7e2666f8e` | feat(ui): use Tab to switch focus between shell and input |
| B39 | PICK | `e9c9dd1d672` | DONE | `cdbe30f82` | feat(core): support shipping built-in skills with the CLI |
| B40 | PICK | `8d3e93cdb0d` | DONE | `f2f4824be` | Migrate keybindings |
| B41 | REIMPLEMENT | `c572b9e9ac6` | DONE | `57690669f` | feat(cli): cleanup activity logs alongside session files |
| B42 | PICK | `2fc61685a32` | DONE | `864d3827a` | feat(cli): implement dynamic terminal tab titles |
| B43 | PICK | `6adae9f7756` | DONE | `1a988e681` | fix: Set both tab and window title |
| B44 | REIMPLEMENT | `304caa4e43a` | DONE | `ef06be74c` | fix(cli): refine Action Required indicator and focus hints |
| B45 | REIMPLEMENT | `a6dca02344b` | DONE | `95f2204a4` | Refactor beforeAgent and afterAgent hookEvents |
| B46 | REIMPLEMENT | `aa524625503` | DONE | `419b7aea3` | Implement support for subagents as extensions |
| B47 | PICK | `91fcca3b1c7 e931ebe581b` | DONE | `87de1333d` | baseTimestamp optional; improve key binding names |
| B48 | REIMPLEMENT | `92e31e3c4ae` | DONE | `8dbec5745` | feat(core, cli): Add support for agents in settings.json |
| B49 | PICK | `e8be252b755 c7c409c68fb 778de55fd8c 8dbaa2bceaf` | DONE | `b5e030da0` | skills install fix; OSC52 SSH/WSL; skill docs; ctrl+x editor |
| B50 | PICK | `eda47f587cf` | DONE | `59657e9fb` | fix(core): Resolve race condition in tool response reporting |
| B51 | REIMPLEMENT | `8030404b08b` | DONE | `108324fc8` | Behavioral evals framework |
| B52 | REIMPLEMENT | `66e7b479ae4` | DONE | `62b7b1034` | Aggregate test results |
| B53 | PICK | `bb6c5741443 f6a5fa0e03a` | DONE | `1118595e3` | admin-enforced settings for Agent Skills; rationale renders before tool calls |
| B54 | PICK | `ea0e3de4302` | SKIPPED | — | NO-OP: ModelInfo deduplication not applicable (LLxprt doesn't emit ModelInfo) |
| B55 | PICK | `217f2775805` | DONE | `787da2234` | fix: update currentSequenceModel when modelChanged |

## Summary

- **Total batches:** 55
- **Completed:** 52
- **Skipped (NO-OP):** 3 (B15, B28, B54)
- **Format fix commits:** `3f797b777` (after B55)
