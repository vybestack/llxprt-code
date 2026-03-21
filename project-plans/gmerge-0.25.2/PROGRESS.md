# Execution Progress: gemini-cli v0.24.5 → v0.25.2

Track batch execution here while following `PLAN.md`.

## Status Values

- `TODO`
- `DOING`
- `DONE`
- `SKIPPED`

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit | Notes |
| ----: | ---- | --------------- | ------ | ------------- | ----- |
| B1 | PICK | `da85e3f8f23 982eee63b61 a26463b056d 2d683bb6f8a` | TODO | — | feat(core): improve activate_skill tool and use lowercase XML tags (#16009); Hx support (#16032); [Skills] Foundation: Centralize management logic and feedback rendering (#15952); [Skills] Multi-scope skill enablement and shadowing fix (#15953) |
| B2 | REIMPLEMENT | `5fe5d1da467` | TODO | — | policy: extract legacy policy from core tool scheduler to policy engine (#15902) |
| B3 | REIMPLEMENT | `416d243027d` | TODO | — | Enhance TestRig with process management and timeouts (#15908) |
| B4 | PICK | `8f9bb6bccc6` | TODO | — | Update troubleshooting doc for UNABLE_TO_GET_ISSUER_CERT_LOCALLY (#16069) |
| B5 | REIMPLEMENT | `97b31c4eefa` | TODO | — | Simplify extension settings command (#16001) |
| B6 | PICK | `57012ae5b33` | TODO | — | Core data structure updates for Rewind functionality (#15714) |
| B7 | REIMPLEMENT | `c64b5ec4a3a` | TODO | — | feat(hooks): simplify hook firing with HookSystem wrapper methods (#15982) |
| B8 | REIMPLEMENT | `4c961df3136` | TODO | — | feat(core): Decouple enabling hooks UI from subsystem. (#16074) |
| B9 | REIMPLEMENT | `17b3eb730a9` | TODO | — | docs: add docs for hooks + extensions (#16073) |
| B10 | PICK | `1bd4f9d8b6f d48c934357c 3e2f4eb8ba1 722c4933dc3` | TODO | — | Optimize json-output tests with mock responses (#16102); feat(cli): add filepath autosuggestion after slash commands (#14738); [Skills] UX Polishing: Transparent feedback and CLI refinements (#15954); Polish: Move 'Failed to load skills' warning to debug logs (#16142) |
| B11 | REIMPLEMENT | `030847a80a4` | TODO | — | feat(cli): export chat history in /bug and prefill GitHub issue (#16115) |
| B12 | REIMPLEMENT | `97ad3d97cba` | TODO | — | Reapply "feat(admin): implement extensions disabled" (#16082) (#16109) |
| B13 | REIMPLEMENT | `660368f2490` | TODO | — | bug(core): Fix spewie getter in hookTranslator.ts (#16108) |
| B14 | REIMPLEMENT | `eb3f3cfdb8a` | TODO | — | feat(hooks): add mcp_context to BeforeTool and AfterTool hook inputs (#15656) |
| B15 | PICK | `1a4ae413978` | TODO | — | fix: yolo should auto allow redirection (#16183) |
| B16 | PICK | `f8138262fa7 fbfad06307c 01d2d437372 e5f7a9c4240 4ab1b9895ad` | TODO | — | fix(cli): disableYoloMode shouldn't enforce default approval mode against args (#16155); feat: add native Sublime Text support to IDE detection (#16083); Add support for Antigravity terminal in terminal setup utility (#16051); feat: implement file system reversion utilities for rewind (#15715); Ensure TERM is set to xterm-256color (#15828) |
| B17 | REIMPLEMENT | `18dd399cb57` | TODO | — | Support @ suggestions for subagents (#16201) |
| B18 | REIMPLEMENT | `e1e3efc9d04` | TODO | — | feat(hooks): Support explicit stop and block execution control in model hooks (#15947) |
| B19 | REIMPLEMENT | `41e627a7ee4` | TODO | — | Refine Gemini 3 system instructions to reduce model verbosity (#16139) |
| B20 | PICK | `88f1ec8d0ae` | TODO | — | Always enable bracketed paste (#16179) |
| B21 | REIMPLEMENT | `77e226c55fe` | TODO | — | Show settings source in extensions lists (#16207) |
| B22 | PICK | `8bc3cfe29a6 c1401682ed0 14f0cb45389` | TODO | — | feat(skills): add pr-creator skill and enable skills (#16232); fix: handle Shift+Space in Kitty keyboard protocol terminals (#15767); feat(ui): reduce home directory warning noise and add opt-out setting (#16229) |
| B23 | REIMPLEMENT | `c7d17dda49d` | TODO | — | fix: properly use systemMessage for hooks in UI (#16250) |
| B24 | PICK | `ea7393f7fd5 e04a5f0cb0e 1fb55dcb2e0` | TODO | — | Infer modifyOtherKeys support (#16270); feat(core): Cache ignore instances for performance (#16185); Autogenerate docs/cli/settings.md (#14408) |
| B25 | REIMPLEMENT | `b08b0d715b5` | TODO | — | Update system prompt to prefer non-interactive commands (#16117) |
| B26 | REIMPLEMENT | `461c277bf2d` | TODO | — | Support for Built-in Agent Skills (#16045) |
| B27 | REIMPLEMENT | `0e955da1710` | TODO | — | feat(cli): add /chat debug command for nightly builds (#16339) |
| B28 | PICK | `93b57b82c10` | TODO | — | style: format pr-creator skill (#16381) |
| B29 | REIMPLEMENT | `9703fe73cf9` | TODO | — | feat(cli): Hooks enable-all/disable-all feature with dynamic status (#15552) |
| B30 | PICK | `64c75cb767c` | TODO | — | Fix crash on unicode character (#16420) |
| B31 | REIMPLEMENT | `950244f6b00` | TODO | — | Attempt to resolve OOM w/ useMemo on history items (#16424) |
| B32 | REIMPLEMENT | `8a2e0fac0d8` | TODO | — | Add other hook wrapper methods to hooksystem (#16361) |
| B33 | PICK | `15891721ad0` | TODO | — | feat: introduce useRewindLogic hook for conversation history navigation (#15716) |
| B34 | PICK | `64cde8d4395` | TODO | — | fix(policy): enhance shell command safety and parsing (#15034) |
| B35 | PICK | `3b678a4da0f 8437ce940a1 e049d5e4e8f` | TODO | — | fix(core): avoid 'activate_skill' re-registration warning (#16398); Revert "Update extension examples" (#16442); Fix: add back fastreturn support (#16440) |
| B36 | PICK | `95d9a339966` | TODO | — | migrate yolo/auto-edit keybindings (#16457) |
| B37 | PICK | `2e8c6cfdbb8` | TODO | — | feat(cli): add install and uninstall commands for skills (#16377) |
| B38 | PICK | `ca6786a28bd` | TODO | — | feat(ui): use Tab to switch focus between shell and input (#14332) |
| B39 | PICK | `e9c9dd1d672` | TODO | — | feat(core): support shipping built-in skills with the CLI (#16300) |
| B40 | PICK | `8d3e93cdb0d` | TODO | — | Migrate keybindings (#16460) |
| B41 | REIMPLEMENT | `c572b9e9ac6` | TODO | — | feat(cli): cleanup activity logs alongside session files (#16399) |
| B42 | PICK | `2fc61685a32` | TODO | — | feat(cli): implement dynamic terminal tab titles for CLI status (#16378) |
| B43 | PICK | `6adae9f7756` | TODO | — | fix: Set both tab and window title instead of just window title (#16464) |
| B44 | REIMPLEMENT | `304caa4e43a` | TODO | — | fix(cli): refine 'Action Required' indicator and focus hints (#16497) |
| B45 | REIMPLEMENT | `a6dca02344b` | TODO | — | Refactor beforeAgent and afterAgent hookEvents to follow desired output (#16495) |
| B46 | REIMPLEMENT | `aa524625503` | TODO | — | Implement support for subagents as extensions. (#16473) |
| B47 | PICK | `91fcca3b1c7 e931ebe581b` | TODO | — | refactor: make baseTimestamp optional in addItem and remove redundant calls (#16471); Improve key binding names and descriptions (#16529) |
| B48 | REIMPLEMENT | `92e31e3c4ae` | TODO | — | feat(core, cli): Add support for agents in settings.json. (#16433) |
| B49 | PICK | `e8be252b755 c7c409c68fb 778de55fd8c 8dbaa2bceaf` | TODO | — | fix(cli): fix 'gemini skills install' unknown argument error (#16537); fix(cli): copy uses OSC52 only in SSH/WSL (#16554); docs(skills): clarify skill directory structure and file location (#16532); Fix: make ctrl+x use preferred editor (#16556) |
| B50 | PICK | `eda47f587cf` | TODO | — | fix(core): Resolve race condition in tool response reporting (#16557) |
| B51 | REIMPLEMENT | `8030404b08b` | TODO | — | Behavioral evals framework. (#16047) |
| B52 | REIMPLEMENT | `66e7b479ae4` | TODO | — | Aggregate test results. (#16581) |
| B53 | PICK | `bb6c5741443 f6a5fa0e03a` | TODO | — | feat(admin): support admin-enforced settings for Agent Skills (#16406); fix(ui): ensure rationale renders before tool calls (#17043) |
| B54 | PICK | `ea0e3de4302` | TODO | — | fix(core): deduplicate ModelInfo emission in GeminiClient (#17075) |
| B55 | PICK | `217f2775805` | TODO | — | fix: update currentSequenceModel when modelChanged (#17051) |
