# Windows Multibyte Encoding Fix - Context

## Current Status

- Branch: `winmultibyte` (created from main after merging winfix)
- Working on: Issue #72 - RunShellCommand fails in multibyte environment (cp932/Japanese)

## The Issue

When running commands like `git branch` on Windows with Japanese locale (cp932), users see:

```
Command failed with exit code 1: cmd.exe """/c""" """git" "branch""" """git" "branch"""
'""' は、内部コマンドまたは外部コマンド、操作可能なプログラムまたはバッチ ファイルとして認識されていません。
```

Key problems:

1. Excessive quoting: `"""/c""" """git" "branch"""`
2. Command duplication: `"""git" "branch""" """git" "branch"""`
3. Garbled Japanese text (encoding issue)

## Previous Work Analyzed

- Branch `shell-multibyte` exists with encoding improvements
- It added proper encoding detection (`getSystemEncoding()`)
- It improved shell execution with `pickUserShell()` and `needsShell()`
- BUT: It doesn't fix the root cause - the excessive quoting happens BEFORE shellExecutionService

## Our Approach

1. Find where RunShellCommand constructs the command string
2. Fix the quoting/escaping logic that's causing the duplication
3. Incorporate the valuable encoding work from shell-multibyte
4. Test with Japanese code page (cp932)

## Testing Setup

To test, open Windows Terminal and run:

```
chcp 932
cd C:\Users\Shadow\projects\llxprt-main\winbug\llxprt-code
npm run build && npm run lint && npm run format
node packages/cli/bin/llxprt-code.js
```

Then in llxprt-code, try: `run git branch`

## Files Likely Involved

- `packages/core/src/tools/shell.ts` - The RunShellCommand tool
- `packages/core/src/services/shellExecutionService.ts` - Shell execution
- `packages/core/src/utils/systemEncoding.ts` - Encoding detection

## Next Steps

1. Find the source of excessive quoting in RunShellCommand
2. Fix the command construction logic
3. Ensure proper encoding handling
4. Test with cp932 encoding

## Branch History

- `winfix` - Fixed Windows encoding for API key files and tests (merged to main)
- `winmultibyte` - Current branch for fixing multibyte shell execution
- `shell-multibyte` - Existing branch with partial fixes (good encoding work, but doesn't fix quoting)
