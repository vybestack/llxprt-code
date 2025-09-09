# Cherry-Pick Checklist (Cleaned)
**Branch**: 20250908-gmerge  
**Note**: Removed 5 commits that should be in SKIP category (GitHub workflows and telemetry)

## PHASE 1: CHERRY-PICK BATCHES (Adjusted)

### Batch 1 (3 commits after cleanup) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-08)
- **Commits**:
  - ✅ `21c6480b6` - Refac: Centralize storage file management (partial)
  - ✅ `b6e779634` - docs: Update keyboard shortcuts for input clearing functionality
  - ✅ `99b1ba9d1` - Add enterprise settings docs
- **Removed**: c668699e7 (workflows), 99f03bf36 (clearcut)

### Batch 2 (5 commits) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `fd64d89da` - fix: copy command gets stuck
  - ✅ `4642de2a5` - MCP tools parameter handling
  - ✅ `1738d4074` - return JSON stringified parameters from getDescription for MCP tools
  - ✅ `6aff66f50` - feat(core): Handle special characters in file search paths
  - ✅ `0e9b06d5c` - feat(ide): improve IDE installation UX and feedback

### Batch 3 (5 commits) - PARTIALLY COMPLETED
- ✅ **Status**: PARTIALLY COMPLETED (2025-09-09) - 4/5 commits found
- **Commits**:
  - ✅ `0193ce77d` - Remove unnecessary FileErrorType
  - ✅ `653267a64` - Remove unused attribute
  - ✅ `a590a033b` - test(integration): add failing test for stdin context with prompt
  - ✅ `16360588d` - Add integration test to confirm environment variable propagation
  - ❌ `a64394a4f` - (fix): Change broken emojis

### Batch 4 (5 commits) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `63f9e86bc` - feat(mcp-client): Handle 401 error for httpUrl
  - ✅ `f8f79bf2f` - fix(core): avoid error handling on cancelled requests to prevent crash
  - ✅ `ba5309c40` - Force restart on trust level change to reload settings
  - ✅ `589f5e682` - feat(cli): prompt completion
  - ✅ `0a7879272` - Fix stats display layout

### Batch 5 (4 commits after cleanup) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `714b3dab7` - chore(lint config): add test-utils to eslint config
  - ✅ `1e5ead696` - perf(core): parallelize memory discovery file operations performance gain
  - ✅ `720eb8189` - At Command Race Condition Bugfix For Non-Interactive Mode
  - ✅ `ec41b8db8` - feat(core): Annotate remaining error paths in tools with type
- **Removed**: 299bf5830 (workflow)

### Batch 6 (5 commits) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `679acc45b` - fix(docs): path of chat checkpoints in manual
  - ✅ `10286934e` - Introduce initial screen reader mode handling and flag
  - ✅ `29699274b` - feat(settings) support editing string settings
  - ✅ `14ca687c0` - test(integration-tests): isolate user memory from test runs
  - ✅ `5be9172ad` - fix(ide): preserve focus when showing diff view

### Batch 7 (5 commits) - PARTIALLY COMPLETED
- ✅ **Status**: PARTIALLY COMPLETED (2025-09-09) - 4/5 commits found
- **Commits**:
  - ❌ `348fa6c7c` - fix(console): fix debug icon rendering in "Debug Console" Box
  - ✅ `51f642f0a` - fix: Ctrl+E should move to current line end, not buffer end
  - ✅ `ef46d64ae` - Fix(grep): memory overflow in grep search and enhance test coverage
  - ✅ `4ced997d6` - feat(search): Add option to disable fuzzy search
  - ✅ `31cd35b8c` - fix(tools): Add an end of file list marker to ReadManyFilesTool

### Batch 8 (4 commits after cleanup) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `e1d5dc545` - fix(checkpointing): improve error handling and messaging for Git issues
  - ✅ `3b29f1186` - fix(cli): improve stdin handling and add initial state check
  - ✅ `56ad22b39` - fix(core): citation markers misplaced in search results containing multibyte characters
  - ✅ `9c1490e98` - fix(copyCommand): provide friendlier error messages for `/copy` command
- **Removed**: c4a788b7b (workflow)

### Batch 9 (5 commits) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `5de66b490` - feat(mcp): Improve MCP prompt argument parsing
  - ✅ `76bbbac7f` - bug(core): Fix for "no changes" edits
  - ✅ `d35abdab9` - fix(editors): fix neovim closing when using `modify with editor`
  - ✅ `240830afa` - feat(mcp): log include MCP request with error
  - ✅ `4b79ef877` - feat(cli): Allow themes to be specified as file paths

### Batch 10 (5 commits) - PARTIALLY COMPLETED
- ✅ **Status**: PARTIALLY COMPLETED (2025-09-09) - 4/5 commits found
- **Commits**:
  - ✅ `9a0722625` - Fix crash when encountering an included directory which doesn't exist
  - ❌ `75822d350` - Change the type of ToolResult.responseParts
  - ✅ `33d49291e` - fix(cli): Support special characters in sandbox profile path
  - ✅ `fef89f542` - Filter thought parts before passing them to CountToken
  - ✅ `53067fda7` - Add support for debug logging of keystrokes to investigate #6227

### Batch 11 (5 commits) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `1a89d1852` - fix: slash command completion menu column width and spacing issues
  - ✅ `da73f13d0` - fix(core): Skip loop check for dividers
  - ✅ `d89f7ea9b` - fix(cli): gemini command stuck in git bash
  - ✅ `494a996ff` - feat(core): share file list patterns between glob and grep tools
  - ✅ `5bba15b03` - fix(cli): Improve proxy test isolation and sandbox path resolution

### Batch 12 (5 commits) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `a8cac96cc` - Support JSON schema formats using ajv-formats
  - ✅ `bedd1d2c2` - Add `.prettierignore` file
  - ✅ `04953d60c` - Introduce system defaults (vs system overrides)
  - ✅ `49cce8a15` - chore(test): install and configure vitest eslint plugin
  - ✅ `0bd496bd5` - [extensions] Add extension management install command

### Batch 13 (5 commits) - PARTIALLY COMPLETED
- ✅ **Status**: PARTIALLY COMPLETED (2025-09-09) - 4/5 commits found
- **Commits**:
  - ✅ `ade703944` - [extensions] Add extensions uninstall command
  - ❌ `7fa592f34` - Show error instead of aborting if model fails to call tool
  - ✅ `4170dbdac` - fix: misaligned right border on tool calls ui and spacing in multiple tool calls ui
  - ✅ `0641b1c09` - [extensions] Add extensions list command
  - ✅ `776627c85` - refactor(ide): Improve IDE detection discovery

### Batch 14 (5 commits) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `41ece1a8b` - fix(keyboard): Implement Tab and Backspace handling for Kitty Protocol
  - ✅ `f32a54fef` - [extensions] Add extensions update command
  - ✅ `ee4feea00` - chore: consistently import node modules with prefix
  - ✅ `1b2249fb8` - feat(ide): Enable Firebase Studio install now that FS has updated VsCode
  - ✅ `db0bf2b71` - refactor(cli): Improve Kitty keycode handling and tests

### Batch 15 (5 commits) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `71c090c69` - feat: add golden snapshot test for ToolGroupMessage and improve success symbol
  - ✅ `0f031a7f8` - Explict imports & exports with `type` modifier
  - ✅ `28912589d` - unused deps
  - ✅ `d820c2335` - fix(core): enable thinking explicitly in flash-lite models
  - ✅ `8075300e3` - chore: remove CLI flags `all_files` and `show_memory_usage`

### Batch 16 (5 commits) - NOT STARTED
- ⬜ **Status**: NOT STARTED - No commits found in git log
- **Commits**:
  - ⬜ `2c6794fee` - fix: resolve three flaky tests
  - ⬜ `ae1f67df0` - feat: Disable YOLO and AUTO_EDIT modes for untrusted folders
  - ⬜ `75b1e01bb` - fix(ide): remove noisy error log
  - ⬜ `b6cca0116` - [extensions] Add an initial set of extension variables
  - ⬜ `97ce197f3` - Treat undefined same as true for isTrustedFolder

### Batch 17 (5 commits) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `45fff8f9f` - Fix(command): line/block Comments Incorrectly Parsed as Slash Commands
  - ✅ `7e3157781` - Standardize exit codes
  - ✅ `d77391b3c` - Downgrade branch_protection to `log`
  - ✅ `dff175c4f` - [extensions] Add disable command
  - ✅ `1fd6a2f0b` - chore: format & imports

### Batch 18 (5 commits) - PARTIALLY COMPLETED
- ✅ **Status**: PARTIALLY COMPLETED (2025-09-09) - 1/5 commits found
- **Commits**:
  - ✅ `0324dc2eb` - chore: unused deps
  - ⬜ `51bb624d4` - Add extensions enable command
  - ⬜ `c33a0da1d` - feat(mcp): Add ODIC fallback to OAuth metadata look up
  - ⬜ `52dae2c58` - feat(cli): Add --allowed-tools flag to bypass tool confirmation
  - ⬜ `4e49ee4c7` - Make config non optional in ToolConfirmationMessage

### Batch 19 (5 commits) - NOT STARTED
- ⬜ **Status**: NOT STARTED - No commits found in git log
- **Commits**:
  - ⬜ `cf9de689c` - fix(#6392): latest prompt being reloaded when ending a persistent process
  - ⬜ `bdd63ce3e` - Added usage details to /tools command
  - ⬜ `df79433be` - Downgrade version of ripgrep to the version from 7 months ago
  - ⬜ `142192ae5` - fix(cli) - Add logging for shell errors
  - ⬜ `366483853` - feat(cli) - Define shared interface for storage

### Batch 20 (5 commits) - NOT STARTED
- ⬜ **Status**: NOT STARTED - No commits found in git log
- **Commits**:
  - ⬜ `327c5f889` - Print error when failing to build sandbox
  - ⬜ `6fb01ddcc` - Update colors tokens for inputer/footer
  - ⬜ `3e74ff71b` - feat(errors): Make errors more informative
  - ⬜ `2df3480cb` - fix(cli): make Ctrl+C UI test less flaky
  - ⬜ `c79f145b3` - Add prompt to migrate workspace extensions

### Batch 21 (4 commits after cleanup) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `83a40ff9d` - fix: unset GEMINI_API_KEY env var if empty
  - ✅ `4c3ec1f0c` - refactor: centralize tool status symbols in constants
  - ✅ `99a28e6b6` - fix: Enable disableFuzzySearch config option propagation
  - ✅ `0c1f3acc7` - fix: make test more reliable
- **Removed**: a33293ac6 (workflow)

### Batch 22 (5 commits) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `023053ed9` - fix(tests): Fix Firebase Studio to IDE detection tests
  - ✅ `5cf1c7bf7` - feat(cli) - Define base class for token storage
  - ✅ `f2092b1eb` - fix(bug): correct /about command in bug report template
  - ✅ `19f2a07ef` - Fix shell argument parsing in windows
  - ✅ `cd2e237c7` - fix(compression): Discard compression result if it results in more token usage

### Batch 23 (5 commits) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `af4fe611e` - Fix diff rendering in windows
  - ✅ `5e8400629` - fix(e2e): add missing deps to fix sandbox module not found errors
  - ✅ `b8a7bfd13` - fix(e2e): skip flaky stdin context test
  - ✅ `bfdddcbd9` - feat(commands): Enable @file processing in TOML commands
  - ✅ `52cc0f6fe` - Fix setting migration nosiness and merging

### Batch 24 (2 commits) - COMPLETED
- ✅ **Status**: COMPLETED (2025-09-09)
- **Commits**:
  - ✅ `2fb14ead1` - Hotfix for issue #7730
  - ✅ `ad3bc17e4` - fix(process-utils): fix bug that prevented start-up when running process walking command fails

## PHASE 2: NEEDS-REVIEW INDIVIDUAL COMMITS (16 commits)
[Same as before - no changes needed]

## Summary of Changes
- **Removed 5 commits** that should be in SKIP category:
  1. c668699e7 - GitHub workflows only
  2. 99f03bf36 - clearcut-logger tests (component removed)
  3. 299bf5830 - GitHub workflow only
  4. c4a788b7b - GitHub workflow only
  5. a33293ac6 - GitHub workflow only

- **Adjusted batch sizes**:
  - Batch 1: 5 → 3 commits
  - Batch 5: 5 → 4 commits
  - Batch 8: 5 → 4 commits
  - Batch 21: 5 → 4 commits

- **New total**: 115 CHERRY-PICK commits (down from 120)