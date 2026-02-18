# LLxprt Code Hook System — Use Case Examples

A cookbook / recipe guide for hook script authors and users. Each recipe is a
complete, copy-pasteable example you can drop into your project and start using
immediately.

> **Status labels:** Each recipe is labeled with its current implementation status:
> - **[Works Today]** — The recipe works end-to-end with the current codebase because it relies only on **side effects** (writing files, sending webhooks, creating git stashes) and does not depend on the caller consuming hook outputs. The hook script runs, the side effect happens, and the script returns a no-op output (e.g., `{}` or `{"decision": "allow"}`).
> - **[Observation Only Today]** — The hook script runs and the HookRunner processes its output, but the caller currently uses `void` (fire-and-forget) so the output is never consumed. Side effects within the script (e.g., running Prettier) work today, but output-dependent effects (e.g., `additionalContext` injection) do not. The recipe will work fully **after the rewrite** (see technical-overview.md sections 5-6).
> - **[After Rewrite Only]** — The recipe depends on the caller consuming hook outputs (blocking decisions, modified requests/responses, tool config restrictions, synthetic responses). In the current codebase, all callers use `void` fire-and-forget, so these outputs are discarded. The hook script runs and the HookRunner processes the output correctly, but the end-to-end effect does not occur until the rewrite.

---

## Table of Contents

### Security & Safety
1. [Secret Scanning](#1-secret-scanning)
2. [Dangerous Command Blocking](#2-dangerous-command-blocking)
3. [File Protection](#3-file-protection)
4. [PII Redaction](#4-pii-redaction)

### Workflow Automation
5. [Auto-Format on Write](#5-auto-format-on-write)
6. [Auto-Test After Edit](#6-auto-test-after-edit)
7. [Git Checkpoint](#7-git-checkpoint)
8. [TDD Enforcement](#8-tdd-enforcement)

### Context & Intelligence
9. [Context Injection](#9-context-injection)
10. [Tool Filtering (Read-Only Mode)](#10-tool-filtering-read-only-mode)
11. [Cost Control](#11-cost-control)
12. [Response Caching](#12-response-caching)

### Compliance & Operations
13. [Audit Logging](#13-audit-logging)
14. [Slack Notification](#14-slack-notification)

### Non-Interactive / CI
15. [CI Safety Net](#15-ci-safety-net)

### Resilience & Advanced Patterns
16. [Timeout-Resilient Policy Service](#16-timeout-resilient-policy-service)
17. [Multi-Hook Sequential Chaining (BeforeModel)](#17-multi-hook-sequential-chaining-beforemodel)
18. [Multimodal Lossiness Caveat](#18-multimodal-lossiness-caveat)

---

## Quick Reference

| # | Use Case | Hook Event | Can Block? | Mode | Status |
|---|---|---|---|---|---|
| 1 | Secret Scanning | BeforeTool | Yes | Both | [After Rewrite Only] |
| 2 | Dangerous Command Blocking | BeforeTool | Yes | Both | [After Rewrite Only] |
| 3 | File Protection | BeforeTool | Yes | Both | [After Rewrite Only] |
| 4 | PII Redaction | AfterModel | No (modifies) | Both | [After Rewrite Only] |
| 5 | Auto-Format on Write | AfterTool | No (injects context) | Both | [Observation Only Today] |
| 6 | Auto-Test After Edit | AfterTool | No (injects context) | Both | [Observation Only Today] |
| 7 | Git Checkpoint | BeforeTool | No (always allows) | Both | [Works Today] |
| 8 | TDD Enforcement | BeforeTool | Yes | Both | [After Rewrite Only] |
| 9 | Context Injection | BeforeModel | No (modifies request) | Both | [After Rewrite Only] |
| 10 | Tool Filtering | BeforeToolSelection | No (restricts tools) | Both | [After Rewrite Only] |
| 11 | Cost Control | BeforeModel | Yes | Both | [After Rewrite Only] |
| 12 | Response Caching | BeforeModel + AfterModel | Yes (synthetic response) | Both | [After Rewrite Only] |
| 13 | Audit Logging | AfterTool | No (pure audit) | Both | [Works Today] |
| 14 | Slack Notification | AfterTool | No (pure notification) | Both | [Works Today] |
| 15 | CI Safety Net | BeforeTool | Yes | Both | [After Rewrite Only] |
| 16 | Timeout-Resilient Policy Service | BeforeTool | Yes | Both | [After Rewrite Only] |
| 17 | Multi-Hook Sequential Chaining | BeforeModel | No (modifies request) | Both | [After Rewrite Only] |
| 18 | Multimodal Lossiness Caveat | AfterModel | No (modifies) | Both | [After Rewrite Only] |

---

## Prerequisites

All examples assume you have a `.llxprt/settings.json` in your project root
(or `~/.llxprt/settings.json` for user-wide hooks). Every example requires
`enableHooks` to be `true`.

Hook scripts must be executable:
```bash
chmod +x .llxprt/hooks/your-script.sh
```

### Environment variables available in every hook script

| Variable | Value |
|---|---|
| `$LLXPRT_PROJECT_DIR` | Project root directory |
| `$GEMINI_PROJECT_DIR` | Same (Gemini CLI compatibility) |
| `$CLAUDE_PROJECT_DIR` | Same (Claude Code compatibility) |

### Exit code cheat sheet

| Exit Code | Meaning |
|---|---|
| `0` | Success — stdout is parsed for decisions/modifications |
| `2` | Block — the operation is prevented; stderr becomes the reason if no JSON reason |
| Any other | Error — warning logged, operation proceeds (fail-open) |

---

## Security & Safety

---

### 1. Secret Scanning

> **Status: [After Rewrite Only]** — BeforeTool hooks currently fire via `void triggerBeforeToolHook(...)`, so blocking decisions are never consumed by the caller. After the rewrite, the caller will `await` the result and honor block decisions.

**Scan file writes for leaked secrets (AWS keys, API tokens, passwords) and block the write before it hits disk.**

#### Why you want this

A developer accidentally pastes an AWS access key into a config file. The AI
agent writes it to disk, it gets committed, pushed, and scraped by bots within
minutes. The resulting $30K AWS bill is real — this happened to someone. This
hook catches secrets *before* `write_file` or `replace` executes.

#### Hook Event

**BeforeTool** — fires before `write_file` and `replace` execute, giving us a
chance to inspect and block the content.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/secret-scan.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/secret-scan.sh
# Scans write_file and replace content for leaked secrets.

set -euo pipefail

INPUT=$(cat)

# Extract the content being written — check both "content" (write_file)
# and "new_string" (replace) fields
CONTENT=$(echo "$INPUT" | jq -r '
  .tool_input.content // .tool_input.new_string // empty
')

if [ -z "$CONTENT" ]; then
  # No content to scan — allow
  echo '{"decision": "allow"}'
  exit 0
fi

# --- Secret patterns ---
ISSUES=""

# AWS Access Key ID (starts with AKIA, 20 chars)
if echo "$CONTENT" | grep -qE 'AKIA[0-9A-Z]{16}'; then
  ISSUES="${ISSUES}AWS Access Key ID detected. "
fi

# AWS Secret Access Key (40-char base64)
if echo "$CONTENT" | grep -qE '(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])' 2>/dev/null; then
  # Heuristic: 40-char strings near "aws" or "secret"
  if echo "$CONTENT" | grep -iqE '(aws|secret|credential)'; then
    ISSUES="${ISSUES}Possible AWS Secret Key detected. "
  fi
fi

# Generic API key patterns
if echo "$CONTENT" | grep -qEi '(api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*["\x27]?[A-Za-z0-9_\-]{20,}'; then
  ISSUES="${ISSUES}API key/secret assignment detected. "
fi

# GitHub Personal Access Token
if echo "$CONTENT" | grep -qE 'ghp_[A-Za-z0-9]{36}'; then
  ISSUES="${ISSUES}GitHub Personal Access Token detected. "
fi

# Slack tokens
if echo "$CONTENT" | grep -qE 'xox[baprs]-[A-Za-z0-9\-]{10,}'; then
  ISSUES="${ISSUES}Slack token detected. "
fi

# Private keys
if echo "$CONTENT" | grep -qE 'BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY'; then
  ISSUES="${ISSUES}Private key detected. "
fi

# Password assignments
if echo "$CONTENT" | grep -qEi 'password\s*[:=]\s*["\x27][^"\x27]{8,}'; then
  ISSUES="${ISSUES}Hardcoded password detected. "
fi

if [ -n "$ISSUES" ]; then
  FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.absolute_path // "unknown file"')
  jq -n \
    --arg reason "[ALERT] SECRET DETECTED in $FILE: ${ISSUES}Remove the secret and use environment variables instead." \
    '{"decision": "block", "reason": $reason}'
  exit 0
fi

echo '{"decision": "allow"}'
exit 0
```

#### What the JSON stdin looks like

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "BeforeTool",
  "timestamp": "2026-02-15T23:30:00.000Z",
  "transcript_path": "",
  "tool_name": "write_file",
  "tool_input": {
    "file_path": "/home/dev/my-project/src/config.ts",
    "content": "export const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';\nexport const DB_URL = 'localhost:5432';\n"
  }
}
```

#### What the JSON stdout should look like (when blocking)

```json
{
  "decision": "block",
  "reason": "[ALERT] SECRET DETECTED in /home/dev/my-project/src/config.ts: AWS Access Key ID detected. Remove the secret and use environment variables instead."
}
```

#### What the JSON stdout should look like (when allowing)

```json
{
  "decision": "allow"
}
```

#### Expected behavior

When the hook fires:
- The script reads the `tool_input.content` (for `write_file`) or `tool_input.new_string` (for `replace`)
- Runs regex patterns against the content
- If a secret is found: returns `decision: "block"` — the file is **not written**, and the model sees the block reason as the tool's output, prompting it to fix the code
- If clean: returns `decision: "allow"` — the write proceeds normally
- If the script crashes or times out: the write proceeds (fail-open)

#### Mode compatibility

Works in **both** interactive and non-interactive (`--prompt`) modes. The hook
fires regardless of how LLxprt Code was invoked.

---

### 2. Dangerous Command Blocking

> **Status: [After Rewrite Only]** — BeforeTool blocking decisions are not consumed by current callers. See recipe #1 for details.

**Block destructive shell commands like `rm -rf /`, `DROP TABLE`, `git push --force`, and `chmod 777` before they execute.**

#### Why you want this

The AI agent is powerful but occasionally overzealous. A misunderstood request
could lead to `rm -rf /`, a force-push that rewrites shared history, or a
`DROP TABLE` that wipes production data. This hook is your safety net — it
blocks known-dangerous patterns while allowing normal development commands.

#### Hook Event

**BeforeTool** — fires before `run_shell_command` executes.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "run_shell_command",
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/block-dangerous-commands.sh",
            "timeout": 3000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/block-dangerous-commands.sh
# Blocks known-dangerous shell commands.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Normalize: lowercase for case-insensitive matching
CMD_LOWER=$(echo "$COMMAND" | tr '[:upper:]' '[:lower:]')

block_with_reason() {
  jq -n --arg reason "$1" '{"decision": "block", "reason": $reason}'
  exit 0
}

# --- Filesystem destruction ---
# rm -rf with root or parent traversal
if echo "$COMMAND" | grep -qE 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\s+/($|\s)'; then
  block_with_reason "BLOCKED: 'rm -rf /' would destroy the entire filesystem."
fi
if echo "$COMMAND" | grep -qE 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\s+\.\./'; then
  block_with_reason "BLOCKED: 'rm -rf' with parent directory traversal is too dangerous."
fi

# chmod 777 on anything
if echo "$COMMAND" | grep -qE 'chmod\s+(-[a-zA-Z]*\s+)?777\s'; then
  block_with_reason "BLOCKED: 'chmod 777' makes files world-writable. Use specific permissions (e.g., 755, 644)."
fi

# --- Database destruction ---
if echo "$CMD_LOWER" | grep -qE 'drop\s+(table|database|schema)\s'; then
  block_with_reason "BLOCKED: DROP TABLE/DATABASE/SCHEMA detected. This would permanently delete data."
fi
if echo "$CMD_LOWER" | grep -qE 'truncate\s+table\s'; then
  block_with_reason "BLOCKED: TRUNCATE TABLE detected. This would permanently delete all rows."
fi

# --- Git danger zone ---
if echo "$COMMAND" | grep -qE 'git\s+push\s+.*--force($|\s)'; then
  block_with_reason "BLOCKED: 'git push --force' rewrites remote history. Use '--force-with-lease' if you must."
fi
if echo "$COMMAND" | grep -qE 'git\s+clean\s+.*-fd'; then
  block_with_reason "BLOCKED: 'git clean -fd' permanently deletes untracked files. Be more selective."
fi
if echo "$COMMAND" | grep -qE 'git\s+reset\s+--hard\s+origin/'; then
  block_with_reason "BLOCKED: 'git reset --hard origin/' discards all local commits and changes."
fi

# --- System modification ---
if echo "$CMD_LOWER" | grep -qE '(curl|wget)\s.*\|\s*(sudo\s+)?(bash|sh|zsh)'; then
  block_with_reason "BLOCKED: Piping a download directly to a shell is dangerous. Download first, inspect, then run."
fi

# --- Formatting disk ---
if echo "$CMD_LOWER" | grep -qE 'mkfs\.|format\s+c:'; then
  block_with_reason "BLOCKED: Disk formatting command detected."
fi

# All clear
echo '{"decision": "allow"}'
exit 0
```

#### What the JSON stdin looks like

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "BeforeTool",
  "timestamp": "2026-02-15T23:30:00.000Z",
  "transcript_path": "",
  "tool_name": "run_shell_command",
  "tool_input": {
    "command": "git push origin main --force",
    "description": "Force push to main branch"
  }
}
```

#### What the JSON stdout should look like (when blocking)

```json
{
  "decision": "block",
  "reason": "BLOCKED: 'git push --force' rewrites remote history. Use '--force-with-lease' if you must."
}
```

#### What the JSON stdout should look like (when allowing)

```json
{
  "decision": "allow"
}
```

#### Expected behavior

- The script extracts the `command` from `tool_input`
- Runs it against a list of dangerous patterns
- If a match is found: blocks with a clear explanation of **why** it's dangerous and **what to do instead**
- If no match: allows the command to proceed
- The model sees the block reason, so it can adjust its approach (e.g., use `--force-with-lease` instead of `--force`)

#### Mode compatibility

Works in **both** interactive and non-interactive modes.

---

### 3. File Protection

> **Status: [After Rewrite Only]** — BeforeTool blocking decisions are not consumed by current callers. See recipe #1 for details.

**Prevent the AI from writing to sensitive files like `.env`, `.env.local`, production configs, and secrets files.**

#### Why you want this

Your `.env` file contains database credentials, API keys, and service tokens.
Your `production.config.json` has deployment settings. These files should only
be edited by humans with full awareness of the consequences. This hook draws a
hard line: the AI cannot touch protected files, period.

#### Hook Event

**BeforeTool** — fires before `write_file` and `replace` execute.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/protect-files.sh",
            "timeout": 3000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/protect-files.sh
# Blocks writes to sensitive files.

set -euo pipefail

INPUT=$(cat)

# Extract the target file path
FILE=$(echo "$INPUT" | jq -r '
  .tool_input.file_path //
  .tool_input.absolute_path //
  .tool_input.path //
  empty
')

if [ -z "$FILE" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Get just the filename for pattern matching
BASENAME=$(basename "$FILE")

# --- Protected file patterns ---
PROTECTED_PATTERNS=(
  '.env'
  '.env.local'
  '.env.production'
  '.env.staging'
  '.env.development'
  'production.config'
  'production.config.json'
  'production.config.yaml'
  'production.config.yml'
  'secrets.json'
  'secrets.yaml'
  'secrets.yml'
  '.secrets'
  'credentials.json'
  'service-account.json'
  'id_rsa'
  'id_ed25519'
  'id_ecdsa'
)

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [ "$BASENAME" = "$pattern" ]; then
    jq -n \
      --arg reason "PROTECTED FILE: '$BASENAME' is a sensitive file and cannot be modified by the AI. Edit this file manually." \
      '{"decision": "block", "reason": $reason}'
    exit 0
  fi
done

# Block any file in a secrets/ or .secrets/ directory
if echo "$FILE" | grep -qE '/(\.?secrets|\.?credentials|\.?keys)/'; then
  jq -n \
    --arg reason "PROTECTED DIRECTORY: Files in secrets/credentials/keys directories cannot be modified by the AI." \
    '{"decision": "block", "reason": $reason}'
  exit 0
fi

# Block Kubernetes secrets
if echo "$FILE" | grep -qE '(secret|sealed-secret).*\.ya?ml$' && echo "$FILE" | grep -qE '/k8s/|/kubernetes/|/manifests/'; then
  jq -n \
    --arg reason "PROTECTED: Kubernetes secret manifests cannot be modified by the AI." \
    '{"decision": "block", "reason": $reason}'
  exit 0
fi

echo '{"decision": "allow"}'
exit 0
```

#### What the JSON stdin looks like

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "BeforeTool",
  "timestamp": "2026-02-15T23:31:00.000Z",
  "transcript_path": "",
  "tool_name": "write_file",
  "tool_input": {
    "file_path": "/home/dev/my-project/.env.local",
    "content": "DATABASE_URL=postgres://prod-server:5432/mydb\nAPI_KEY=sk-live-abc123\n"
  }
}
```

#### What the JSON stdout should look like (when blocking)

```json
{
  "decision": "block",
  "reason": "PROTECTED FILE: '.env.local' is a sensitive file and cannot be modified by the AI. Edit this file manually."
}
```

#### Expected behavior

- Extracts the file path from `tool_input` (handles `file_path`, `absolute_path`, and `path` variants)
- Checks the basename against a list of known sensitive filenames
- Checks the full path against sensitive directory patterns
- If protected: blocks immediately with a clear message
- The model learns it cannot touch these files and will suggest manual edits instead

#### Mode compatibility

Works in **both** interactive and non-interactive modes.

---

### 4. PII Redaction

> **Status: [After Rewrite Only]** — The current codebase calls `void triggerAfterModelHook(...)`, so AfterModel hook outputs are never consumed. The script runs and produces correct output, but the modified response is discarded. After the rewrite, the caller will `await` the result and apply the modified `llm_response`.

**Scan the model's response for personally identifiable information (SSNs, credit card numbers, email addresses, phone numbers) and replace them with `[REDACTED]`.**

#### Why you want this

Sometimes the model echoes back PII from context, training data, or files it
read. If you're working in a regulated environment (healthcare, finance), PII
in model output is a compliance violation. This hook scrubs it from the
stored/processed response used downstream (transcript, context for the next
model call).

> **Streaming caveat:** AfterModel hooks fire **after** all streaming chunks have been displayed to the user. This means the user may see unredacted PII during streaming before the hook runs. The redaction applies to the stored response used for transcript and subsequent model turns, but **not** to the real-time streaming display. For compliance-critical use cases requiring real-time redaction, per-chunk AfterModel processing would be needed (see technical-overview.md §11.1). This is a known limitation of the current post-stream architecture.

#### Hook Event

**AfterModel** — fires after the model responds, before the response is
displayed or processed.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "AfterModel": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/redact-pii.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/redact-pii.sh
# Scans model responses for PII and redacts it.

set -euo pipefail

INPUT=$(cat)

# Extract the full text response
TEXT=$(echo "$INPUT" | jq -r '.llm_response.text // empty')

if [ -z "$TEXT" ]; then
  # No text to scan — pass through unchanged
  echo '{}'
  exit 0
fi

REDACTED="$TEXT"
FOUND_PII=false

# --- SSN: XXX-XX-XXXX ---
if echo "$REDACTED" | grep -qE '\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b'; then
  REDACTED=$(echo "$REDACTED" | sed -E 's/\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b/[SSN REDACTED]/g')
  FOUND_PII=true
fi

# --- Credit Card Numbers (13-19 digits, with or without separators) ---
if echo "$REDACTED" | grep -qE '\b[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{1,7}\b'; then
  REDACTED=$(echo "$REDACTED" | sed -E 's/\b[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{1,7}\b/[CARD REDACTED]/g')
  FOUND_PII=true
fi

# --- Email Addresses ---
if echo "$REDACTED" | grep -qEi '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'; then
  REDACTED=$(echo "$REDACTED" | sed -E 's/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/[EMAIL REDACTED]/g')
  FOUND_PII=true
fi

# --- US Phone Numbers ---
if echo "$REDACTED" | grep -qE '\b(\+?1[-.]?)?\(?[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b'; then
  REDACTED=$(echo "$REDACTED" | sed -E 's/\b(\+?1[-.]?)?\(?[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/[PHONE REDACTED]/g')
  FOUND_PII=true
fi

if [ "$FOUND_PII" = true ]; then
  # Rebuild the response with redacted text in the candidates
  echo "$INPUT" | jq --arg redacted "$REDACTED" '
    .llm_response.text = $redacted |
    .llm_response.candidates[0].content.parts = [$redacted] |
    {
      "hookSpecificOutput": {
        "llm_response": .llm_response
      }
    }
  '
else
  # No PII found — pass through unchanged
  echo '{}'
fi

exit 0
```

#### What the JSON stdin looks like

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "AfterModel",
  "timestamp": "2026-02-15T23:32:00.000Z",
  "transcript_path": "",
  "llm_request": {
    "model": "gemini-2.0-flash",
    "messages": [
      { "role": "user", "content": "Show me the customer record for John." }
    ],
    "config": { "temperature": 0.7 }
  },
  "llm_response": {
    "text": "Here is the customer record:\n- Name: John Smith\n- SSN: 123-45-6789\n- Email: john.smith@example.com\n- Phone: (555) 123-4567\n- Card: 4111-1111-1111-1111",
    "candidates": [
      {
        "content": {
          "role": "model",
          "parts": ["Here is the customer record:\n- Name: John Smith\n- SSN: 123-45-6789\n- Email: john.smith@example.com\n- Phone: (555) 123-4567\n- Card: 4111-1111-1111-1111"]
        },
        "finishReason": "STOP"
      }
    ]
  }
}
```

#### What the JSON stdout should look like (when PII found)

```json
{
  "hookSpecificOutput": {
    "llm_response": {
      "text": "Here is the customer record:\n- Name: John Smith\n- SSN: [SSN REDACTED]\n- Email: [EMAIL REDACTED]\n- Phone: [PHONE REDACTED]\n- Card: [CARD REDACTED]",
      "candidates": [
        {
          "content": {
            "role": "model",
            "parts": ["Here is the customer record:\n- Name: John Smith\n- SSN: [SSN REDACTED]\n- Email: [EMAIL REDACTED]\n- Phone: [PHONE REDACTED]\n- Card: [CARD REDACTED]"]
          },
          "finishReason": "STOP"
        }
      ]
    }
  }
}
```

#### What the JSON stdout should look like (when no PII found)

```json
{}
```

#### Expected behavior

**[After Rewrite]:**
- Extracts the model's text response from `llm_response.text`
- Runs regex patterns for SSNs, credit cards, emails, and phone numbers
- If PII is found: returns a modified `llm_response` with redacted values via `hookSpecificOutput`
- The caller applies the modified response; the user sees the redacted version
- If no PII: returns empty object, response passes through unchanged

**[Current limitation]:** The hook script runs and produces correct output, but `geminiChat.ts` calls `void triggerAfterModelHook(...)` so the modified response is discarded. The user sees the original unredacted response.

**Multimodal caveat:** The hook translator only extracts text parts from model responses. If the model returns non-text content (images, function calls), those parts are not visible to the hook script and cannot be redacted. Returning a modified `llm_response` will lose non-text parts — see recipe #18 (Multimodal Lossiness Caveat) for safe modification patterns. See also overview.md §5 for translator lossiness details.

#### Mode compatibility

Works in **both** interactive and non-interactive modes (after the rewrite).

---

## Workflow Automation

---

### 5. Auto-Format on Write

> **Status: [Observation Only Today]** — The hook script runs and Prettier formats the file (the side effect works), but the `additionalContext` injection is not consumed by the caller because `void triggerAfterToolHook(...)` discards the result. After the rewrite, the model will see the formatting note.

**Automatically run Prettier (or your formatter) on every file the AI writes, then tell the model the file was formatted.**

#### Why you want this

The AI doesn't always match your exact formatting preferences. Instead of
fighting with it or fixing formatting manually, let Prettier handle it
automatically. The `additionalContext` injection tells the model the file was
reformatted, so it doesn't try to "fix" the formatting back.

#### Hook Event

**AfterTool** — fires after `write_file` completes, so we format the file
that was just written.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "AfterTool": [
      {
        "matcher": "write_file",
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/auto-format.sh",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/auto-format.sh
# Runs prettier on files after they're written.

set -euo pipefail

INPUT=$(cat)

FILE=$(echo "$INPUT" | jq -r '
  .tool_input.file_path //
  .tool_input.absolute_path //
  .tool_input.path //
  empty
')

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo '{}'
  exit 0
fi

# Only format files that Prettier understands
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.css|*.scss|*.less|*.html|*.md|*.yaml|*.yml|*.graphql)
    ;;
  *)
    echo '{}'
    exit 0
    ;;
esac

# Run prettier — suppress errors if prettier is not installed
if command -v npx &>/dev/null && npx prettier --check "$FILE" &>/dev/null 2>&1; then
  # File is already formatted
  echo '{}'
  exit 0
fi

if npx prettier --write "$FILE" 2>/dev/null; then
  jq -n --arg file "$(basename "$FILE")" '{
    "hookSpecificOutput": {
      "additionalContext": ($file + " was auto-formatted by Prettier. The on-disk version may differ slightly from what you wrote — this is expected.")
    }
  }'
else
  # Prettier failed — that's fine, don't block anything
  echo '{}'
fi

exit 0
```

#### What the JSON stdin looks like

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "AfterTool",
  "timestamp": "2026-02-15T23:33:00.000Z",
  "transcript_path": "",
  "tool_name": "write_file",
  "tool_input": {
    "file_path": "/home/dev/my-project/src/utils.ts",
    "content": "export function  add(a:number,b:number){return a+b}"
  },
  "tool_response": {
    "llmContent": "File written successfully to /home/dev/my-project/src/utils.ts",
    "returnDisplay": "File written successfully",
    "error": null
  }
}
```

#### What the JSON stdout should look like

```json
{
  "hookSpecificOutput": {
    "additionalContext": "utils.ts was auto-formatted by Prettier. The on-disk version may differ slightly from what you wrote — this is expected."
  }
}
```

#### Expected behavior

- After `write_file` completes, the hook checks if the file is a type Prettier supports
- Runs `npx prettier --write` on the file
- Injects `additionalContext` so the model knows the file was reformatted
- The model sees "File written successfully" + the formatting note, and won't try to reformat
- If Prettier is not installed or fails, the hook exits cleanly (no disruption)

#### Mode compatibility

Works in **both** interactive and non-interactive modes.

---

### 6. Auto-Test After Edit

> **Status: [Observation Only Today]** — The hook script runs and tests execute (the side effect works), but the `additionalContext` injection is discarded by the caller. After the rewrite, the model will see the test results.

**Run the project's test suite whenever the AI edits a source file, and inject the test results as context for the model.**

#### Why you want this

The model should know immediately when its changes break tests. Instead of
waiting until you ask it to run tests, this hook runs them automatically after
every file write and feeds the results back. The model can then fix failures
proactively.

#### Hook Event

**AfterTool** — fires after `write_file` or `replace` to run tests on the
changed code.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "AfterTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/auto-test.sh",
            "timeout": 60000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/auto-test.sh
# Runs tests after file edits and injects results as context.

set -euo pipefail

INPUT=$(cat)

FILE=$(echo "$INPUT" | jq -r '
  .tool_input.file_path //
  .tool_input.absolute_path //
  .tool_input.path //
  empty
')

# Only run tests for source files (not configs, docs, etc.)
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.py|*.go|*.rs)
    ;;
  *)
    echo '{}'
    exit 0
    ;;
esac

PROJECT_DIR=$(echo "$INPUT" | jq -r '.cwd')
cd "$PROJECT_DIR"

# Detect test runner and run tests (capture output, limit to 100 lines)
TEST_OUTPUT=""
TEST_EXIT=0

if [ -f "package.json" ]; then
  # Node.js project — run only related tests for speed
  RELATED_TEST=""
  case "$FILE" in
    *.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.spec.ts|*.spec.tsx)
      RELATED_TEST="$FILE"
      ;;
    *)
      # Look for corresponding test file
      TEST_FILE="${FILE%.ts}.test.ts"
      [ -f "$TEST_FILE" ] && RELATED_TEST="$TEST_FILE"
      TEST_FILE="${FILE%.tsx}.test.tsx"
      [ -f "$TEST_FILE" ] && RELATED_TEST="$TEST_FILE"
      ;;
  esac

  if [ -n "$RELATED_TEST" ]; then
    TEST_OUTPUT=$(npx vitest run "$RELATED_TEST" --reporter=verbose 2>&1 | tail -100) || TEST_EXIT=$?
  else
    # No related test found — skip (don't run full suite on every write)
    echo '{}'
    exit 0
  fi
elif [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
  TEST_OUTPUT=$(python -m pytest --tb=short -q 2>&1 | tail -50) || TEST_EXIT=$?
else
  # No recognized test runner
  echo '{}'
  exit 0
fi

FILENAME=$(basename "$FILE")

if [ $TEST_EXIT -eq 0 ]; then
  CONTEXT="[OK] Tests passed after editing $FILENAME."
else
  CONTEXT=$(printf "[ERROR] Tests FAILED after editing %s (exit code %d). Output:\n%s" "$FILENAME" "$TEST_EXIT" "$TEST_OUTPUT")
fi

jq -n --arg ctx "$CONTEXT" '{
  "hookSpecificOutput": {
    "additionalContext": $ctx
  }
}'

exit 0
```

#### What the JSON stdin looks like

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "AfterTool",
  "timestamp": "2026-02-15T23:34:00.000Z",
  "transcript_path": "",
  "tool_name": "write_file",
  "tool_input": {
    "file_path": "/home/dev/my-project/src/math.ts",
    "content": "export function add(a: number, b: number): number {\n  return a - b; // BUG!\n}\n"
  },
  "tool_response": {
    "llmContent": "File written successfully to /home/dev/my-project/src/math.ts",
    "returnDisplay": "File written successfully",
    "error": null
  }
}
```

#### What the JSON stdout should look like (tests failing)

```json
{
  "hookSpecificOutput": {
    "additionalContext": "[ERROR] Tests FAILED after editing math.ts (exit code 1). Output:\n FAIL  src/math.test.ts\n   add(1, 2) should return 3 (expected 3, got -1)\n\n Tests: 1 failed, 1 total"
  }
}
```

#### Expected behavior

- After a source file is written, the hook finds the corresponding test file
- Runs only the related tests (not the full suite — that would be too slow)
- Injects test results as `additionalContext`
- The model sees "File written + [ERROR] Tests FAILED" and can immediately fix the bug
- If no test file exists or no test runner is found, the hook silently passes

#### Mode compatibility

Works in **both** interactive and non-interactive modes.

---

### 7. Git Checkpoint

> **Status: [Works Today]** — This hook only performs a side effect (git stash) and always returns `allow`. It does not depend on caller output consumption.

**Create a git stash or commit checkpoint before every risky operation, so you can always roll back.**

#### Why you want this

The AI is about to modify files or run a shell command that might break things.
By creating a lightweight checkpoint beforehand, you can always `git stash pop`
or `git revert` to get back to a known-good state. This hook never blocks — it
just quietly creates a safety net.

#### Hook Event

**BeforeTool** — fires before `write_file`, `replace`, and `run_shell_command`
to snapshot the current state.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace|run_shell_command",
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/git-checkpoint.sh",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/git-checkpoint.sh
# Creates a git checkpoint before risky operations.
# Never blocks — always returns exit 0.

set -uo pipefail
# Note: intentionally not using -e — we want to always exit 0

INPUT=$(cat)
PROJECT_DIR=$(echo "$INPUT" | jq -r '.cwd')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

cd "$PROJECT_DIR" 2>/dev/null || { echo '{"decision": "allow"}'; exit 0; }

# Only checkpoint in git repos
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Check if there are any changes to stash
if git diff --quiet && git diff --cached --quiet; then
  # Working tree is clean — nothing to checkpoint
  echo '{"decision": "allow"}'
  exit 0
fi

# Create a checkpoint stash (doesn't affect working tree)
STASH_MSG="llxprt-checkpoint: before ${TOOL_NAME} at ${TIMESTAMP}"
if git stash push -m "$STASH_MSG" --keep-index --quiet 2>/dev/null; then
  # Immediately pop it back — we just wanted the stash entry as a backup
  git stash pop --quiet 2>/dev/null || true
fi

# Always allow — this hook is purely protective
echo '{"decision": "allow"}'
exit 0
```

#### What the JSON stdin looks like

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "BeforeTool",
  "timestamp": "2026-02-15T23:35:00.000Z",
  "transcript_path": "",
  "tool_name": "write_file",
  "tool_input": {
    "file_path": "/home/dev/my-project/src/database.ts",
    "content": "// new database config..."
  }
}
```

#### What the JSON stdout should look like

```json
{
  "decision": "allow"
}
```

#### Expected behavior

- Before any write or shell command, creates a git stash entry as a checkpoint
- Immediately pops the stash so the working tree is unchanged
- The stash entry remains in the reflog, so you can recover with `git stash list` → `git stash apply stash@{N}`
- **Never blocks** — always returns `decision: "allow"` with exit code 0
- If not in a git repo or working tree is clean, does nothing

#### Mode compatibility

Works in **both** interactive and non-interactive modes.

---

### 8. TDD Enforcement

> **Status: [After Rewrite Only]** — BeforeTool blocking decisions are not consumed by current callers. See recipe #1 for details.

**Block source file writes unless a corresponding test file exists — enforcing test-first development.**

#### Why you want this

Your team practices TDD. The rule is: no production code without a test. This
hook enforces that the AI writes tests first. If the model tries to create
`src/userService.ts` without `src/userService.test.ts` already existing, the
write is blocked with a message telling it to create the test first.

#### Hook Event

**BeforeTool** — fires before `write_file` to check for a corresponding test.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file",
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/tdd-enforce.sh",
            "timeout": 3000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/tdd-enforce.sh
# Blocks source file writes unless a corresponding test file exists.

set -euo pipefail

INPUT=$(cat)

FILE=$(echo "$INPUT" | jq -r '
  .tool_input.file_path //
  .tool_input.absolute_path //
  .tool_input.path //
  empty
')

if [ -z "$FILE" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

BASENAME=$(basename "$FILE")
DIRNAME=$(dirname "$FILE")

# --- Skip files that don't need tests ---
# Allow test files themselves
case "$BASENAME" in
  *.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx)
    echo '{"decision": "allow"}'
    exit 0
    ;;
esac

# Allow non-source files (configs, types, constants, etc.)
case "$BASENAME" in
  *.json|*.yaml|*.yml|*.md|*.css|*.scss|*.html|*.svg|*.d.ts)
    echo '{"decision": "allow"}'
    exit 0
    ;;
  index.ts|index.tsx|index.js|index.jsx)
    # Index/barrel files usually don't need individual tests
    echo '{"decision": "allow"}'
    exit 0
    ;;
  *.config.*|*.setup.*|*.types.*)
    echo '{"decision": "allow"}'
    exit 0
    ;;
esac

# Only enforce for TypeScript/JavaScript source files
case "$BASENAME" in
  *.ts|*.tsx|*.js|*.jsx)
    ;;
  *)
    echo '{"decision": "allow"}'
    exit 0
    ;;
esac

# --- Check for corresponding test file ---
# Strip extension and look for .test.* variants
NAME_NO_EXT="${BASENAME%.*}"
EXT="${BASENAME##*.}"

FOUND_TEST=false
for test_suffix in "test" "spec"; do
  for test_ext in "$EXT" "ts" "tsx" "js" "jsx"; do
    TEST_FILE="${DIRNAME}/${NAME_NO_EXT}.${test_suffix}.${test_ext}"
    if [ -f "$TEST_FILE" ]; then
      FOUND_TEST=true
      break 2
    fi
  done
  # Also check __tests__ directory
  TEST_FILE="${DIRNAME}/__tests__/${NAME_NO_EXT}.${test_suffix}.${EXT}"
  if [ -f "$TEST_FILE" ]; then
    FOUND_TEST=true
    break
  fi
done

if [ "$FOUND_TEST" = false ]; then
  jq -n \
    --arg name "$NAME_NO_EXT" \
    --arg ext "$EXT" \
    --arg dir "$DIRNAME" \
    '{
      "decision": "block",
      "reason": ("TDD ENFORCEMENT: No test file found for \'" + $name + "." + $ext + "\'. Create " + $dir + "/" + $name + ".test." + $ext + " first, then write the implementation.")
    }'
  exit 0
fi

echo '{"decision": "allow"}'
exit 0
```

#### What the JSON stdin looks like

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "BeforeTool",
  "timestamp": "2026-02-15T23:36:00.000Z",
  "transcript_path": "",
  "tool_name": "write_file",
  "tool_input": {
    "file_path": "/home/dev/my-project/src/services/userService.ts",
    "content": "export class UserService {\n  async getUser(id: string) { ... }\n}\n"
  }
}
```

#### What the JSON stdout should look like (when blocking)

```json
{
  "decision": "block",
  "reason": "TDD ENFORCEMENT: No test file found for 'userService.ts'. Create /home/dev/my-project/src/services/userService.test.ts first, then write the implementation."
}
```

#### Expected behavior

- Before writing a TypeScript/JavaScript source file, checks for a corresponding `.test.*` or `.spec.*` file
- Skips enforcement for: test files themselves, config files, type definitions, index/barrel files, non-code files
- If no test exists: blocks with a message telling the model to write the test first
- The model will then create the test file (allowed, since test files skip the check), and then retry the implementation write (now allowed, since the test exists)

#### Mode compatibility

Works in **both** interactive and non-interactive modes.

---

## Context & Intelligence

---

### 9. Context Injection

> **Status: [After Rewrite Only]** — BeforeModel request modifications are not consumed by current callers (`void triggerBeforeModelHook(...)` discards the result). After the rewrite, the modified `llm_request` with injected messages will be sent to the model.

**Inject recent git history, current branch name, and project context into every model request.**

#### Why you want this

The model works better when it knows what you've been doing. By injecting the
last 5 git commits and the current branch name into every request, the model
understands the trajectory of your work without you having to explain it.
"Continue the refactoring I started" just works.

#### Hook Event

**BeforeModel** — fires before the LLM API call, allowing us to modify the
request's messages.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "BeforeModel": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/inject-context.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/inject-context.sh
# Injects git context into every model request.

set -euo pipefail

INPUT=$(cat)

PROJECT_DIR=$(echo "$INPUT" | jq -r '.cwd')
cd "$PROJECT_DIR" 2>/dev/null || { echo '{}'; exit 0; }

# Only works in git repos
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo '{}'
  exit 0
fi

# Gather context
BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
RECENT_COMMITS=$(git log --oneline -5 2>/dev/null || echo "no commits")
DIRTY_FILES=$(git diff --name-only 2>/dev/null | head -10 || echo "none")
STAGED_FILES=$(git diff --cached --name-only 2>/dev/null | head -10 || echo "none")

CONTEXT_MSG=$(cat <<EOF
[Git Context — auto-injected by hook]
Branch: ${BRANCH}
Recent commits:
${RECENT_COMMITS}
Modified files: ${DIRTY_FILES}
Staged files: ${STAGED_FILES}
EOF
)

# Get existing messages and prepend context as a system message
echo "$INPUT" | jq --arg ctx "$CONTEXT_MSG" '
  .llm_request.messages = [
    {"role": "system", "content": $ctx}
  ] + .llm_request.messages |
  {
    "hookSpecificOutput": {
      "llm_request": .llm_request
    }
  }
'

exit 0
```

#### What the JSON stdin looks like

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "BeforeModel",
  "timestamp": "2026-02-15T23:37:00.000Z",
  "transcript_path": "",
  "llm_request": {
    "model": "gemini-2.0-flash",
    "messages": [
      { "role": "user", "content": "Add error handling to the user service" }
    ],
    "config": { "temperature": 0.7 }
  }
}
```

#### What the JSON stdout should look like

```json
{
  "hookSpecificOutput": {
    "llm_request": {
      "model": "gemini-2.0-flash",
      "messages": [
        {
          "role": "system",
          "content": "[Git Context — auto-injected by hook]\nBranch: feature/user-service\nRecent commits:\nabc1234 refactor: extract UserService class\ndef5678 feat: add user CRUD endpoints\nghi9012 chore: update dependencies\nModified files: src/services/userService.ts\nStaged files: none"
        },
        { "role": "user", "content": "Add error handling to the user service" }
      ],
      "config": { "temperature": 0.7 }
    }
  }
}
```

#### Expected behavior

- Before every model call, gathers git branch, recent commits, and dirty/staged files
- Prepends a system message with this context to the request
- The model now knows which branch you're on, what you've been working on, and what files are in progress
- If not in a git repo: returns empty object, request passes through unchanged

#### Mode compatibility

Works in **both** interactive and non-interactive modes.

---

### 10. Tool Filtering (Read-Only Mode)

> **Status: [After Rewrite Only]** — The current codebase calls `void triggerBeforeToolSelectionHook(...)` with `llm_request: {} as never`, so the hook receives no useful request data and its output is never consumed. After the rewrite, the caller will pass real `GenerateContentParameters` via the translator and apply the returned `toolConfig` modifications.

**Restrict the AI to read-only tools for safe code review sessions.**

#### Why you want this

You want the AI to review code, explain it, and suggest changes — but not
actually modify anything. By restricting available tools to `read_file`,
`glob`, `search_file_content`, and `list_directory`, you get a safe read-only
session where the AI can't accidentally write or execute anything.

#### Hook Event

**BeforeToolSelection** — fires before the model sees the available tools,
allowing us to restrict the list.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "BeforeToolSelection": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/read-only-mode.sh",
            "timeout": 3000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/read-only-mode.sh
# Restricts the AI to read-only tools.

cat <<'EOF'
{
  "hookSpecificOutput": {
    "toolConfig": {
      "mode": "ANY",
      "allowedFunctionNames": [
        "read_file",
        "read_many_files",
        "read_line_range",
        "glob",
        "search_file_content",
        "list_directory",
        "ast_grep",
        "structural_analysis"
      ]
    }
  }
}
EOF
```

#### What the JSON stdin looks like

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "BeforeToolSelection",
  "timestamp": "2026-02-15T23:38:00.000Z",
  "transcript_path": "",
  "llm_request": {
    "model": "gemini-2.0-flash",
    "messages": [
      { "role": "user", "content": "Review the authentication module for security issues" }
    ],
    "config": { "temperature": 0.7 }
  }
}
```

#### What the JSON stdout should look like

```json
{
  "hookSpecificOutput": {
    "toolConfig": {
      "mode": "ANY",
      "allowedFunctionNames": [
        "read_file",
        "read_many_files",
        "read_line_range",
        "glob",
        "search_file_content",
        "list_directory",
        "ast_grep",
        "structural_analysis"
      ]
    }
  }
}
```

#### Expected behavior

**[After Rewrite]:**
- Before the model decides which tools to call, the hook will replace the tool config
- `mode: "ANY"` will mean the model must use a tool (no freeform text-only response)
- `allowedFunctionNames` will restrict to read-only tools only
- The model will not be able to call `write_file`, `replace`, `run_shell_command`, or any modifying tool
- It will still be able to read, search, browse, and analyze — making it a perfect code review assistant

**[Current limitation]:** The hook script runs but `geminiChat.ts` calls `void triggerBeforeToolSelectionHook(config, tools)` with `llm_request: {} as never`, so the hook receives no useful request data and its output is never consumed. Tool restriction is not enforced. The rewrite will pass real `GenerateContentParameters` via the translator and apply the returned `toolConfig` modifications.

#### Mode compatibility

Works in **both** interactive and non-interactive modes (after the rewrite). Particularly useful
with `--prompt "Review src/ for security issues"`.

---

### 11. Cost Control

> **Status: [After Rewrite Only]** — BeforeModel blocking decisions are not consumed by current callers. The counter file side effect (tracking call count) works today, but the block decision is discarded. After the rewrite, the model call will actually be prevented.

**Track the number of model API calls and block after exceeding a budget.**

#### Why you want this

LLM API calls cost money. If you're running the agent on a complex task, it
might make 50+ model calls. This hook tracks calls in a temp file and blocks
after N calls, preventing runaway costs. Great for shared team environments or
CI where you want hard limits.

#### Hook Event

**BeforeModel** — fires before every model call, allowing us to count and
block.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "BeforeModel": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/cost-control.sh",
            "timeout": 3000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/cost-control.sh
# Tracks model API calls and blocks after a configurable limit.

set -euo pipefail

INPUT=$(cat)

# --- Configuration ---
MAX_CALLS=${LLXPRT_MAX_MODEL_CALLS:-25}  # Default: 25 calls per session
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
COUNTER_FILE="/tmp/llxprt-cost-control-${SESSION_ID}"

# Initialize counter file if it doesn't exist
if [ ! -f "$COUNTER_FILE" ]; then
  echo "0" > "$COUNTER_FILE"
fi

# Read and increment counter
CURRENT=$(cat "$COUNTER_FILE")
NEXT=$((CURRENT + 1))
echo "$NEXT" > "$COUNTER_FILE"

if [ "$NEXT" -gt "$MAX_CALLS" ]; then
  # Budget exceeded — block with a synthetic response
  jq -n \
    --argjson count "$NEXT" \
    --argjson max "$MAX_CALLS" \
    '{
      "decision": "block",
      "reason": ("BUDGET EXCEEDED: This session has made " + ($count | tostring) + " model calls (limit: " + ($max | tostring) + "). To continue, increase LLXPRT_MAX_MODEL_CALLS or start a new session."),
      "hookSpecificOutput": {
        "llm_response": {
          "candidates": [
            {
              "content": {
                "role": "model",
                "parts": ["I have reached the maximum number of model API calls for this session (" + ($max | tostring) + " calls). To continue working, please increase the limit by setting LLXPRT_MAX_MODEL_CALLS or start a new session."]
              },
              "finishReason": "STOP"
            }
          ]
        }
      }
    }'
else
  REMAINING=$((MAX_CALLS - NEXT))
  # Under budget — allow but log remaining
  echo "{}" >&1
  echo "Model call ${NEXT}/${MAX_CALLS} (${REMAINING} remaining)" >&2
fi

exit 0
```

#### What the JSON stdin looks like

```json
{
  "session_id": "session-xyz-789",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "BeforeModel",
  "timestamp": "2026-02-15T23:39:00.000Z",
  "transcript_path": "",
  "llm_request": {
    "model": "gemini-2.0-flash",
    "messages": [
      { "role": "user", "content": "Now refactor all the remaining controllers" }
    ],
    "config": { "temperature": 0.7 }
  }
}
```

#### What the JSON stdout should look like (when blocking)

```json
{
  "decision": "block",
  "reason": "BUDGET EXCEEDED: This session has made 26 model calls (limit: 25). To continue, increase LLXPRT_MAX_MODEL_CALLS or start a new session.",
  "hookSpecificOutput": {
    "llm_response": {
      "candidates": [
        {
          "content": {
            "role": "model",
            "parts": ["I have reached the maximum number of model API calls for this session (25 calls). To continue working, please increase the limit by setting LLXPRT_MAX_MODEL_CALLS or start a new session."]
          },
          "finishReason": "STOP"
        }
      ]
    }
  }
}
```

#### What the JSON stdout should look like (when allowing)

```json
{}
```

#### Expected behavior

- Tracks model calls using a temp file keyed to the session ID
- Under the limit: allows the call, logs remaining count to stderr (for debugging)
- Over the limit: blocks and returns a synthetic model response explaining the limit
- The synthetic response means the agent terminates gracefully instead of erroring
- Counter resets when a new session starts (new session ID → new temp file)
- Configure the limit via `LLXPRT_MAX_MODEL_CALLS` environment variable

#### Mode compatibility

Works in **both** interactive and non-interactive modes. Especially useful in
CI/non-interactive mode to prevent runaway automation.

---

### 12. Response Caching

> **Status: [After Rewrite Only]** — Both BeforeModel (synthetic response) and AfterModel (cache write observation) require caller output consumption. The cache write side effect in AfterModel works today, but the cache hit (synthetic response blocking) and the response modification are not consumed.

**Cache model responses by request hash to avoid redundant API calls.**

#### Why you want this

During iterative development, the AI often makes identical requests — asking the
same question after a retry, re-reading the same context. A simple cache avoids
paying for (and waiting for) duplicate API calls. The BeforeModel hook checks
the cache; the AfterModel hook populates it.

#### Hook Event

**BeforeModel** (cache check) + **AfterModel** (cache write) — this is a
two-hook recipe.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "BeforeModel": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/cache-check.js",
            "timeout": 3000
          }
        ]
      }
    ],
    "AfterModel": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/cache-write.js",
            "timeout": 3000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script — Cache Check (BeforeModel)

```javascript
#!/usr/bin/env node
// .llxprt/hooks/cache-check.js
// Checks cache for a matching request. Returns synthetic response if found.

const fs = require('fs');
const crypto = require('crypto');

const CACHE_DIR = '/tmp/llxprt-response-cache';
const CACHE_TTL_MS = 3600000; // 1 hour

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const request = data.llm_request;

    // Hash the messages (not config — same question with different temp is same answer)
    const hashContent = JSON.stringify(request.messages);
    const hash = crypto.createHash('sha256').update(hashContent).digest('hex');
    const cacheFile = `${CACHE_DIR}/${hash}.json`;

    if (fs.existsSync(cacheFile)) {
      const stat = fs.statSync(cacheFile);
      const age = Date.now() - stat.mtimeMs;

      if (age < CACHE_TTL_MS) {
        // Cache hit!
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        console.log(JSON.stringify({
          decision: 'block',
          reason: 'Cache hit — using cached response',
          hookSpecificOutput: {
            llm_response: cached
          }
        }));
        return;
      } else {
        // Expired — delete
        fs.unlinkSync(cacheFile);
      }
    }

    // Cache miss — allow the request
    console.log('{}');
  } catch (err) {
    // On any error, allow the request
    console.error(`cache-check error: ${err.message}`);
    console.log('{}');
  }
});
```

#### Hook Script — Cache Write (AfterModel)

```javascript
#!/usr/bin/env node
// .llxprt/hooks/cache-write.js
// Stores model response in cache for future lookups.

const fs = require('fs');
const crypto = require('crypto');

const CACHE_DIR = '/tmp/llxprt-response-cache';

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const request = data.llm_request;
    const response = data.llm_response;

    if (!request || !response) {
      console.log('{}');
      return;
    }

    // Same hash as cache-check
    const hashContent = JSON.stringify(request.messages);
    const hash = crypto.createHash('sha256').update(hashContent).digest('hex');

    // Ensure cache directory exists
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    // Write response to cache
    const cacheFile = `${CACHE_DIR}/${hash}.json`;
    fs.writeFileSync(cacheFile, JSON.stringify(response));

    // Pass through — don't modify the response
    console.log('{}');
  } catch (err) {
    console.error(`cache-write error: ${err.message}`);
    console.log('{}');
  }
});
```

#### What the JSON stdin looks like (BeforeModel — cache check)

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "BeforeModel",
  "timestamp": "2026-02-15T23:40:00.000Z",
  "transcript_path": "",
  "llm_request": {
    "model": "gemini-2.0-flash",
    "messages": [
      { "role": "user", "content": "Explain the authentication flow in this project" }
    ],
    "config": { "temperature": 0.7 }
  }
}
```

#### What the JSON stdout should look like (cache hit)

```json
{
  "decision": "block",
  "reason": "Cache hit — using cached response",
  "hookSpecificOutput": {
    "llm_response": {
      "candidates": [
        {
          "content": {
            "role": "model",
            "parts": ["The authentication flow works as follows: ..."]
          },
          "finishReason": "STOP"
        }
      ]
    }
  }
}
```

#### What the JSON stdout should look like (cache miss / AfterModel write)

```json
{}
```

#### What the JSON stdin looks like (AfterModel — cache write)

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "AfterModel",
  "timestamp": "2026-02-15T23:40:01.000Z",
  "transcript_path": "",
  "llm_request": {
    "model": "gemini-2.0-flash",
    "messages": [
      { "role": "user", "content": "Explain the authentication flow in this project" }
    ],
    "config": { "temperature": 0.7 }
  },
  "llm_response": {
    "text": "The authentication flow works as follows: ...",
    "candidates": [
      {
        "content": {
          "role": "model",
          "parts": ["The authentication flow works as follows: ..."]
        },
        "finishReason": "STOP"
      }
    ]
  }
}
```

#### Expected behavior

- **BeforeModel** (cache-check): hashes the request messages, checks `/tmp/llxprt-response-cache/` for a cached response. If found and fresh (< 1 hour), blocks the model call and returns the cached response as a synthetic response. If not found, allows the call.
- **AfterModel** (cache-write): after the model responds, writes the response to the cache file so future identical requests hit the cache.
- Cache is keyed by message content only. This is intentionally simple but has limitations:
  - **Same question, different model/temperature/config will return the same cached answer.** For production use, include `model`, `temperature`, and other relevant config fields in the hash key.
  - **System prompt changes are not reflected** in the cache key. If you change your system instructions, stale cached responses will be served.
  - This simple approach is suitable for development/experimentation. For production, extend the hash to cover `llm_request.model` + `llm_request.config` + `llm_request.messages`.
- Cache files are in `/tmp/` so they auto-clean on reboot.

#### Mode compatibility

Works in **both** interactive and non-interactive modes.

---

## Compliance & Operations

---

### 13. Audit Logging

> **Status: [Works Today]** — This hook only performs a side effect (writing to a log file) and returns `{}`. It does not depend on caller output consumption.

**Log every tool execution to a JSONL file for compliance and debugging.**

#### Why you want this

In regulated environments (SOC2, HIPAA, finance), you need a record of every
action the AI took. This hook creates an append-only JSONL audit log with
timestamps, tool names, inputs, and outputs. It's also invaluable for debugging
— when something goes wrong, you can replay exactly what happened.

#### Hook Event

**AfterTool** — fires after every tool completes, capturing the full
input/output.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "AfterTool": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/audit-log.sh",
            "timeout": 3000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/audit-log.sh
# Appends every tool execution to a JSONL audit log.
# Pure observation — never blocks, never modifies.

set -euo pipefail

INPUT=$(cat)

PROJECT_DIR=$(echo "$INPUT" | jq -r '.cwd')
LOG_DIR="${PROJECT_DIR}/.llxprt/audit"
LOG_FILE="${LOG_DIR}/tool-audit.jsonl"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Build a compact audit entry
echo "$INPUT" | jq -c '{
  timestamp: .timestamp,
  session_id: .session_id,
  tool_name: .tool_name,
  tool_input_keys: (.tool_input | keys),
  tool_input_summary: (
    if .tool_name == "write_file" or .tool_name == "replace" then
      {file: (.tool_input.file_path // .tool_input.absolute_path // "unknown"), content_length: ((.tool_input.content // .tool_input.new_string // "") | length)}
    elif .tool_name == "run_shell_command" then
      {command: .tool_input.command}
    else
      (.tool_input | to_entries | map({key: .key, value: (.value | tostring | .[0:100])}) | from_entries)
    end
  ),
  tool_success: (.tool_response.error == null),
  tool_error: .tool_response.error,
  response_length: ((.tool_response.llmContent // "") | length)
}' >> "$LOG_FILE"

# Never block — pure audit
echo '{}'
exit 0
```

#### What the JSON stdin looks like

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "AfterTool",
  "timestamp": "2026-02-15T23:41:00.000Z",
  "transcript_path": "",
  "tool_name": "run_shell_command",
  "tool_input": {
    "command": "npm test",
    "description": "Run the test suite"
  },
  "tool_response": {
    "llmContent": "Tests: 42 passed, 0 failed\nAll tests passed.",
    "returnDisplay": "npm test completed successfully",
    "error": null
  }
}
```

#### What the JSON stdout should look like

```json
{}
```

#### What gets written to the audit log

Each line in `.llxprt/audit/tool-audit.jsonl`:
```json
{"timestamp":"2026-02-15T23:41:00.000Z","session_id":"abc-123","tool_name":"run_shell_command","tool_input_keys":["command","description"],"tool_input_summary":{"command":"npm test"},"tool_success":true,"tool_error":null,"response_length":42}
```

#### Expected behavior

- After every tool execution, appends a compact JSON line to the audit log
- Captures: timestamp, session, tool name, input summary, success/failure, response length
- For `write_file`/`replace`: logs file path and content length (not the full content — that could be huge)
- For `run_shell_command`: logs the command
- For other tools: logs truncated input values (first 100 chars)
- **Never blocks, never modifies** — pure observation
- Add `.llxprt/audit/` to `.gitignore` to keep logs out of version control

#### Mode compatibility

Works in **both** interactive and non-interactive modes.

---

### 14. Slack Notification

> **Status: [Works Today]** — This hook only performs a side effect (sending a Slack webhook) and returns `{}`. It does not depend on caller output consumption.

**Send a Slack webhook notification when shell commands complete.**

#### Why you want this

You kicked off a long-running AI task (deploy, big refactor, test suite) and
walked away. This hook pings your Slack channel when shell commands finish, so
you know when to come back. Particularly useful for CI/CD tasks that take
minutes.

#### Hook Event

**AfterTool** — fires after `run_shell_command` completes.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "AfterTool": [
      {
        "matcher": "run_shell_command",
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/slack-notify.sh",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/slack-notify.sh
# Sends Slack notification when shell commands complete.

set -euo pipefail

INPUT=$(cat)

# Read Slack webhook URL from environment
SLACK_WEBHOOK_URL="${LLXPRT_SLACK_WEBHOOK:-}"
if [ -z "$SLACK_WEBHOOK_URL" ]; then
  # No webhook configured — skip silently
  echo '{}'
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // "unknown"')
ERROR=$(echo "$INPUT" | jq -r '.tool_response.error // empty')
PROJECT=$(basename "$(echo "$INPUT" | jq -r '.cwd')")
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp')

if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
  EMOJI="[FAIL]"
  STATUS="FAILED"
  COLOR="#ff0000"
else
  EMOJI="[PASS]"
  STATUS="completed"
  COLOR="#36a64f"
fi

# Truncate command for readability
SHORT_CMD=$(echo "$COMMAND" | head -c 200)

# Send Slack notification
PAYLOAD=$(jq -n \
  --arg emoji "$EMOJI" \
  --arg status "$STATUS" \
  --arg cmd "$SHORT_CMD" \
  --arg project "$PROJECT" \
  --arg ts "$TIMESTAMP" \
  --arg color "$COLOR" \
  '{
    "attachments": [{
      "color": $color,
      "blocks": [
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": ($emoji + " *LLxprt Command " + $status + "*\nProject: " + $project + "\nCommand: " + $cmd + "\nTime: " + $ts)
          }
        }
      ]
    }]
  }')

curl -s -X POST -H 'Content-type: application/json' \
  --data "$PAYLOAD" \
  "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true

# Never block — pure notification
echo '{}'
exit 0
```

#### What the JSON stdin looks like

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "AfterTool",
  "timestamp": "2026-02-15T23:42:00.000Z",
  "transcript_path": "",
  "tool_name": "run_shell_command",
  "tool_input": {
    "command": "npm run build && npm run deploy:staging",
    "description": "Build and deploy to staging"
  },
  "tool_response": {
    "llmContent": "Build succeeded. Deployed to staging at https://staging.example.com",
    "returnDisplay": "Command completed successfully",
    "error": null
  }
}
```

#### What the JSON stdout should look like

```json
{}
```

#### What gets sent to Slack

A formatted message like:
> [PASS] **LLxprt Command completed**
> Project: my-project
> Command: npm run build && npm run deploy:staging
> Time: 2026-02-15T23:42:00.000Z

#### Expected behavior

- After any shell command finishes, sends a Slack webhook notification
- Shows [PASS] for success, [FAIL] for failure
- Includes the project name, command (truncated to 200 chars), and timestamp
- Requires `LLXPRT_SLACK_WEBHOOK` environment variable to be set
- If no webhook URL: silently does nothing
- If the curl fails: silently ignores (never disrupts the agent)
- **Never blocks, never modifies** — pure notification

#### Mode compatibility

Works in **both** interactive and non-interactive modes. Most useful in
non-interactive/CI mode where you're not watching the terminal.

---

## Non-Interactive / CI

---

### 15. CI Safety Net

> **Status: [After Rewrite Only]** — BeforeTool blocking decisions are not consumed by current callers. See recipe #1 for details.

**In headless/CI mode, block any shell command that modifies files outside the project directory.**

#### Why you want this

In CI, the AI agent runs unattended. A bug or hallucination could cause it to
`rm` files in `/tmp`, write to `/etc`, or modify other projects. This hook
enforces a strict sandbox: shell commands can only touch files within the
project directory. It uses extra-paranoid checks that would be too restrictive
for interactive use but are perfect for CI.

#### Hook Event

**BeforeTool** — fires before `run_shell_command` to analyze the command for
out-of-scope file operations.

#### Configuration

```jsonc
// .llxprt/settings.json (in your CI project config)
{
  "enableHooks": true,
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "run_shell_command",
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/ci-safety-net.js",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```javascript
#!/usr/bin/env node
// .llxprt/hooks/ci-safety-net.js
// Extra-strict command validation for CI/headless mode.
// Blocks commands that reference paths outside the project directory.

const path = require('path');

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const command = data.tool_input?.command || '';
    const projectDir = data.cwd;

    // Only enforce in CI/non-interactive mode
    // Check common CI environment variables
    const isCI = process.env.CI === 'true' ||
                 process.env.GITHUB_ACTIONS === 'true' ||
                 process.env.GITLAB_CI === 'true' ||
                 process.env.JENKINS_URL !== undefined ||
                 !process.stdout.isTTY;

    if (!isCI) {
      // Interactive mode — skip strict checks
      console.log(JSON.stringify({ decision: 'allow' }));
      return;
    }

    const issues = [];

    // --- Absolute path references outside project ---
    const absolutePathRegex = /(?:^|\s|["'=])(\/([\w.-]+\/)+[\w.-]*)/g;
    let match;
    while ((match = absolutePathRegex.exec(command)) !== null) {
      const absPath = match[1];
      // Allow /dev/null, /tmp (temporary), and the project dir itself
      if (absPath === '/dev/null') continue;
      if (absPath.startsWith('/tmp/') || absPath === '/tmp') continue;
      if (absPath.startsWith(projectDir)) continue;

      issues.push(`References path outside project: ${absPath}`);
    }

    // --- Commands that write to the filesystem ---
    const dangerousWritePatterns = [
      { pattern: /\bmkdir\b.*-p?\s+\/(?!tmp)/, desc: 'mkdir outside /tmp' },
      { pattern: /\bsudo\b/, desc: 'sudo usage' },
      { pattern: /\bchown\b/, desc: 'chown usage' },
      { pattern: /\bchmod\b/, desc: 'chmod usage' },
      { pattern: /\bln\s+-s?\s/, desc: 'symlink creation' },
      { pattern: /\bmount\b/, desc: 'mount usage' },
      { pattern: /\bsystemctl\b/, desc: 'systemctl usage' },
      { pattern: /\bservice\b/, desc: 'service management' },
      { pattern: />\s*\/(?!tmp|dev\/null)/, desc: 'redirect to absolute path outside /tmp' },
      { pattern: /\bnpm\s+(install|i)\s+-g\b/, desc: 'global npm install' },
      { pattern: /\bpip\s+install\b(?!.*--user)(?!.*-e\s+\.)/, desc: 'system pip install' },
    ];

    for (const { pattern, desc } of dangerousWritePatterns) {
      if (pattern.test(command)) {
        issues.push(desc);
      }
    }

    // --- Environment modification ---
    if (/\bexport\s+(PATH|HOME|USER|SHELL)=/.test(command)) {
      issues.push('Modifies critical environment variables');
    }

    // --- Network access in strict mode ---
    if (process.env.LLXPRT_CI_NO_NETWORK === 'true') {
      if (/\b(curl|wget|fetch|nc|ssh|scp)\b/.test(command)) {
        issues.push('Network access blocked in strict CI mode');
      }
    }

    if (issues.length > 0) {
      console.log(JSON.stringify({
        decision: 'block',
        reason: `CI SAFETY NET: Command blocked.\n${issues.map(i => `  - ${i}`).join('\n')}\n\nIn CI mode, commands can only modify files within the project directory (${projectDir}).`
      }));
    } else {
      console.log(JSON.stringify({ decision: 'allow' }));
    }
  } catch (err) {
    // On any error, allow (fail-open)
    console.error(`ci-safety-net error: ${err.message}`);
    console.log(JSON.stringify({ decision: 'allow' }));
  }
});
```

#### What the JSON stdin looks like

```json
{
  "session_id": "ci-build-456",
  "cwd": "/home/runner/work/my-project/my-project",
  "hook_event_name": "BeforeTool",
  "timestamp": "2026-02-15T23:43:00.000Z",
  "transcript_path": "",
  "tool_name": "run_shell_command",
  "tool_input": {
    "command": "rm -rf /home/runner/.cache && npm install -g typescript",
    "description": "Clean cache and install TypeScript"
  }
}
```

#### What the JSON stdout should look like (when blocking)

```json
{
  "decision": "block",
  "reason": "CI SAFETY NET: Command blocked.\n  - References path outside project: /home/runner/.cache\n  - global npm install\n\nIn CI mode, commands can only modify files within the project directory (/home/runner/work/my-project/my-project)."
}
```

#### What the JSON stdout should look like (when allowing)

```json
{
  "decision": "allow"
}
```

#### Expected behavior

- Detects CI mode via `$CI`, `$GITHUB_ACTIONS`, `$GITLAB_CI`, `$JENKINS_URL`, or non-TTY stdout
- In interactive mode: skips all checks (too restrictive for humans)
- In CI mode, blocks commands that:
  - Reference absolute paths outside the project directory (except `/tmp` and `/dev/null`)
  - Use `sudo`, `chown`, `chmod`, `mount`, `systemctl`, or `service`
  - Redirect output to absolute paths outside `/tmp`
  - Install packages globally (`npm install -g`, system `pip install`)
  - Modify critical environment variables (`PATH`, `HOME`, `USER`, `SHELL`)
- Optional: set `LLXPRT_CI_NO_NETWORK=true` to also block `curl`, `wget`, `ssh`, etc.
- Safe commands within the project directory pass through normally

#### Mode compatibility

**Non-interactive only** — the hook explicitly skips enforcement in interactive
mode. Designed for CI pipelines, `--prompt` mode, and headless execution.

---

### Resilience & Advanced Patterns

---

### 16. Timeout-Resilient Policy Service

> **Status: [After Rewrite Only]** — BeforeTool blocking decisions are not consumed by current callers. The external HTTP call side effect works today, but the block/allow decision is discarded.

**Call an external policy service before tool execution, with graceful timeout fallback.**

#### Why you want this

Your organization runs a centralized policy service (OPA, Cedar, custom REST
endpoint) that must approve tool invocations. But network is unreliable —
the policy service might be slow or down. This hook calls the service with a
tight timeout: if the service responds, honor its decision; if it times out
or errors, allow the operation (fail-open) and log a warning.

#### Hook Event

**BeforeTool** — fires before tool execution to check policy.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "BeforeTool": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/policy-check.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/policy-check.sh
# Checks an external policy service with timeout fallback.
# Fail-open: if the service is unavailable, allow the operation.

set -euo pipefail

INPUT=$(cat)

POLICY_URL="${LLXPRT_POLICY_URL:-}"
if [ -z "$POLICY_URL" ]; then
  # No policy service configured — allow
  echo '{"decision": "allow"}'
  exit 0
fi

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

# Call policy service with a 3-second timeout (within our 5s hook timeout)
RESPONSE=$(curl -s -m 3 \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{"tool_name": "$TOOL_NAME", "session_id": "$SESSION_ID"}" \
  "$POLICY_URL" 2>/dev/null) || {
  # curl failed (timeout, connection refused, DNS error, etc.)
  # Fail-open: allow the operation but warn
  echo "Policy service unreachable at $POLICY_URL — allowing operation (fail-open)" >&2
  echo '{"decision": "allow", "systemMessage": "WARNING: Policy service was unreachable. Operation allowed under fail-open policy."}'
  exit 0
}

# Parse the policy response
DECISION=$(echo "$RESPONSE" | jq -r '.decision // "allow"' 2>/dev/null) || DECISION="allow"
REASON=$(echo "$RESPONSE" | jq -r '.reason // empty' 2>/dev/null) || REASON=""

if [ "$DECISION" = "block" ] || [ "$DECISION" = "deny" ]; then
  jq -n --arg reason "${REASON:-Blocked by policy service}" \
    '{"decision": "block", "reason": $reason}'
else
  echo '{"decision": "allow"}'
fi

exit 0
```

#### What the JSON stdin looks like

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "BeforeTool",
  "timestamp": "2026-02-15T23:44:00.000Z",
  "transcript_path": "",
  "tool_name": "run_shell_command",
  "tool_input": {
    "command": "npm run deploy",
    "description": "Deploy to staging"
  }
}
```

#### What the JSON stdout should look like (service allows)

```json
{
  "decision": "allow"
}
```

#### What the JSON stdout should look like (service blocks)

```json
{
  "decision": "block",
  "reason": "Deployment operations require manager approval. Request approval at https://policy.internal/approve"
}
```

#### What the JSON stdout should look like (service timeout / fail-open)

```json
{
  "decision": "allow",
  "systemMessage": "WARNING: Policy service was unreachable. Operation allowed under fail-open policy."
}
```

#### Expected behavior

**[After Rewrite]:**
- The hook calls the external policy service with a 3-second HTTP timeout
- If the service responds with `"block"`: the tool is blocked with the service's reason
- If the service responds with `"allow"` or any non-block decision: the tool proceeds
- If the service times out, returns an error, or is unreachable: the tool proceeds (fail-open) and a `systemMessage` warns the model that policy was not enforced
- The hook's own timeout is 5 seconds (configured in settings), giving curl 3 seconds plus 2 seconds overhead for JSON processing

**Key resilience patterns demonstrated:**
- **Inner timeout < outer timeout:** The `curl -m 3` timeout is less than the hook's 5-second timeout, ensuring graceful handling rather than being killed by `SIGTERM`
- **Fail-open with warning:** Rather than silently allowing, the `systemMessage` records that policy was not enforced
- **No external dependencies in the critical path:** If the policy URL env var is not set, the hook is a fast no-op

#### Mode compatibility

Works in **both** interactive and non-interactive modes (after the rewrite).

---

### 17. Multi-Hook Sequential Chaining (BeforeModel)

> **Status: [After Rewrite Only]** — BeforeModel hook outputs are not consumed by current callers. The hook scripts run, but their `llm_request` modifications are discarded.

**Chain two BeforeModel hooks sequentially: one injects context, the other enforces token limits — demonstrating safe multi-hook composition.**

#### Why you want this

You have two independent concerns for model calls: (1) inject project-specific
context into every request, and (2) enforce a token budget by trimming old
messages. These must run sequentially — the context injector adds a message,
then the token limiter sees the updated message list (including the injected
context) and can make informed decisions about what to trim. If they ran in
parallel, the token limiter wouldn't see the added context, leading to requests
that exceed the budget.

#### Hook Event

**BeforeModel** — fires before every model call. Two hooks in a **sequential** group.

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "BeforeModel": [
      {
        "sequential": true,
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/inject-project-context.sh",
            "timeout": 3000
          },
          {
            "type": "command",
            "command": ".llxprt/hooks/limit-tokens.sh",
            "timeout": 3000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script 1: inject-project-context.sh

```bash
#!/usr/bin/env bash
# .llxprt/hooks/inject-project-context.sh
# Adds a system message with project conventions to every model request.

set -euo pipefail

INPUT=$(cat)

# Read the existing messages from the request
MESSAGES=$(echo "$INPUT" | jq '.llm_request.messages')

# Build an updated messages array with an injected system message
UPDATED_MESSAGES=$(echo "$MESSAGES" | jq \
  '. + [{"role": "system", "content": "Project conventions: Use TypeScript strict mode. Prefer functional patterns. All functions must have JSDoc comments."}]')

# Return the modified request — only the fields we want to change
# The hookRunner merges this with the original request via shallow merge
jq -n --argjson msgs "$UPDATED_MESSAGES" '{
  "hookSpecificOutput": {
    "llm_request": {
      "messages": $msgs
    }
  }
}'

exit 0
```

#### Hook Script 2: limit-tokens.sh

```bash
#!/usr/bin/env bash
# .llxprt/hooks/limit-tokens.sh
# Trims conversation to last N messages if too long.
# Runs AFTER inject-project-context.sh in the sequential chain,
# so it sees the injected context message.

set -euo pipefail

INPUT=$(cat)

MAX_MESSAGES=${LLXPRT_MAX_MESSAGES:-20}

# Count messages in the (already modified) request
MSG_COUNT=$(echo "$INPUT" | jq '.llm_request.messages | length')

if [ "$MSG_COUNT" -le "$MAX_MESSAGES" ]; then
  # Under budget — no modification needed
  echo '{}'
  exit 0
fi

# Keep the first message (system prompt) and the last (MAX_MESSAGES - 1) messages
TRIMMED=$(echo "$INPUT" | jq --argjson max "$MAX_MESSAGES" '
  .llm_request.messages as $msgs |
  [$msgs[0]] + $msgs[-(($max - 1)):]
')

jq -n --argjson msgs "$TRIMMED" '{
  "hookSpecificOutput": {
    "llm_request": {
      "messages": $msgs
    }
  }
}'

exit 0
```

#### What the JSON stdin looks like (for Hook 1)

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "BeforeModel",
  "timestamp": "2026-02-15T23:45:00.000Z",
  "transcript_path": "",
  "llm_request": {
    "model": "gemini-2.0-flash",
    "messages": [
      { "role": "user", "content": "Refactor the auth module" }
    ],
    "config": { "temperature": 0.7 }
  }
}
```

#### What the JSON stdin looks like (for Hook 2 — after Hook 1's output is applied)

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "BeforeModel",
  "timestamp": "2026-02-15T23:45:00.000Z",
  "transcript_path": "",
  "llm_request": {
    "model": "gemini-2.0-flash",
    "messages": [
      { "role": "user", "content": "Refactor the auth module" },
      { "role": "system", "content": "Project conventions: Use TypeScript strict mode. Prefer functional patterns. All functions must have JSDoc comments." }
    ],
    "config": { "temperature": 0.7 }
  }
}
```

Note how Hook 2 sees the message that Hook 1 injected — this is the key benefit of sequential chaining.

#### Expected behavior

**[After Rewrite]:**
1. Hook 1 (`inject-project-context.sh`) runs first, adds a system message to `llm_request.messages`
2. The `HookRunner.applyHookOutputToInput()` merges Hook 1's output into the input for Hook 2 via shallow merge of `hookSpecificOutput.llm_request`
3. Hook 2 (`limit-tokens.sh`) runs second, sees the updated messages (including the injected context), and trims if needed
4. The final `llm_request` sent to the model includes both the injected context and any trimming

**Shallow merge pitfall:** The `HookRunner` uses shallow merge (`{ ...currentRequest, ...partialRequest }`) for sequential `BeforeModel` chaining. This means if Hook 2 returns a `messages` field, it **completely replaces** Hook 1's `messages` — it does not deep-merge individual messages. Hook 2 must either return the full messages array (as this recipe does) or return only non-overlapping fields (e.g., just `config`). This is by design (see `hookRunner.ts` `applyHookOutputToInput` and `hookAggregator.ts` `mergeWithFieldReplacement`).

#### Mode compatibility

Works in **both** interactive and non-interactive modes (after the rewrite).

---

### 18. Multimodal Lossiness Caveat

> **Status: [After Rewrite Only]** — AfterModel hook outputs are not consumed by current callers. This recipe demonstrates awareness of translator limitations rather than a new capability.

**Safely modify model responses containing tool calls without losing non-text content.**

#### Why you want this

The hook translator (`HookTranslatorGenAIv1`) only extracts **text parts**
from model responses. If the model's response includes tool calls (function
calls), those are silently dropped during translation. If your AfterModel hook
returns a modified `llm_response`, the round-trip through the translator will
lose all non-text content — breaking the agent's tool-calling flow. This recipe
shows how to detect tool calls and skip modification to avoid data loss.

#### Hook Event

**AfterModel** — fires after the model responds. The hook inspects the response
and only modifies it when safe to do so (text-only responses).

#### Configuration

```jsonc
// .llxprt/settings.json
{
  "enableHooks": true,
  "hooks": {
    "AfterModel": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".llxprt/hooks/safe-response-modifier.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

#### Hook Script

```bash
#!/usr/bin/env bash
# .llxprt/hooks/safe-response-modifier.sh
# Demonstrates safe AfterModel modification that avoids multimodal lossiness.
#
# The hook translator (HookTranslatorGenAIv1) only extracts text parts.
# If the model's response contains function calls, returning a modified
# llm_response will lose those function calls — breaking tool execution.
#
# This script checks for indicators of tool-call responses and skips
# modification when non-text content is likely present.

set -euo pipefail

INPUT=$(cat)

TEXT=$(echo "$INPUT" | jq -r '.llm_response.text // empty')

# --- Safety check: detect likely tool-call responses ---
# The translator drops non-text parts, so we can only use heuristics:
# 1. If .llm_response.text is empty/null, the response is likely all function calls
# 2. If finishReason is not "STOP", the response may be incomplete or tool-driven
# 3. If candidates have empty parts arrays, non-text content was filtered out

HAS_TEXT=$(echo "$INPUT" | jq -r '
  if (.llm_response.text // "" | length) > 0 then "yes" else "no" end
')

FINISH_REASON=$(echo "$INPUT" | jq -r '
  .llm_response.candidates[0].finishReason // "UNKNOWN"
')

PARTS_COUNT=$(echo "$INPUT" | jq '
  .llm_response.candidates[0].content.parts | length
')

if [ "$HAS_TEXT" = "no" ]; then
  # No text content — this is likely a pure function-call response.
  # Modifying it would produce an empty response, breaking tool execution.
  echo '{}'
  exit 0
fi

if [ "$FINISH_REASON" != "STOP" ] && [ "$FINISH_REASON" != "MAX_TOKENS" ]; then
  # Unusual finish reason — skip modification to be safe
  echo '{}'
  exit 0
fi

# --- Safe to modify: the response has text content ---
# Example: append a disclaimer to all text responses
MODIFIED_TEXT="${TEXT}

---
_Response processed by organization policy hooks._"

echo "$INPUT" | jq --arg modified "$MODIFIED_TEXT" '{
  "hookSpecificOutput": {
    "llm_response": {
      "text": $modified,
      "candidates": [
        {
          "content": {
            "role": "model",
            "parts": [$modified]
          },
          "finishReason": .llm_response.candidates[0].finishReason
        }
      ]
    }
  }
}'

exit 0
```

#### What the JSON stdin looks like (text-only response — safe to modify)

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "AfterModel",
  "timestamp": "2026-02-15T23:46:00.000Z",
  "transcript_path": "",
  "llm_request": {
    "model": "gemini-2.0-flash",
    "messages": [
      { "role": "user", "content": "Explain the auth module" }
    ]
  },
  "llm_response": {
    "text": "The authentication module uses JWT tokens...",
    "candidates": [
      {
        "content": {
          "role": "model",
          "parts": ["The authentication module uses JWT tokens..."]
        },
        "finishReason": "STOP"
      }
    ]
  }
}
```

#### What the JSON stdin looks like (tool-call response — skip modification)

```json
{
  "session_id": "abc-123",
  "cwd": "/home/dev/my-project",
  "hook_event_name": "AfterModel",
  "timestamp": "2026-02-15T23:46:01.000Z",
  "transcript_path": "",
  "llm_request": {
    "model": "gemini-2.0-flash",
    "messages": [
      { "role": "user", "content": "Read the config file" }
    ]
  },
  "llm_response": {
    "text": "",
    "candidates": [
      {
        "content": {
          "role": "model",
          "parts": []
        },
        "finishReason": "STOP"
      }
    ]
  }
}
```

Note: the `parts` array is empty because the translator filtered out the `functionCall` parts.
The original SDK response contained `{ functionCall: { name: "read_file", args: {...} } }`,
but `HookTranslatorGenAIv1.toHookLLMResponse()` only extracts text parts.

#### What the JSON stdout should look like (text response — modified)

```json
{
  "hookSpecificOutput": {
    "llm_response": {
      "text": "The authentication module uses JWT tokens...

---
_Response processed by organization policy hooks._",
      "candidates": [
        {
          "content": {
            "role": "model",
            "parts": ["The authentication module uses JWT tokens...

---
_Response processed by organization policy hooks._"]
          },
          "finishReason": "STOP"
        }
      ]
    }
  }
}
```

#### What the JSON stdout should look like (tool-call response — skipped)

```json
{}
```

#### Expected behavior

**[After Rewrite]:**
- The hook checks whether the response contains text content
- If the response is text-only (has `.text`, `finishReason` is `STOP` or `MAX_TOKENS`): modifies the response safely
- If the response appears to be a tool-call response (empty text, empty parts, unusual finish reason): returns `{}` (no modification), preserving the original response including all non-text parts
- This prevents the lossy round-trip through `fromHookLLMResponse()` from destroying function calls

**Key insight:** The translator's lossiness is one-way visible to hook authors — they can see that parts are missing (empty arrays, empty text) but cannot see the original non-text content. The safe pattern is: **if you can't see text, don't return a modified response.**

**Related documentation:** See overview.md §5 (Lossy translation caveat) and technical-overview.md §7.3 (Lossy round-trip behavior) for full details on the translator's text-only extraction.

#### Mode compatibility

Works in **both** interactive and non-interactive modes (after the rewrite).

---

## Multi-Hook Conflict Resolution Examples

When multiple hooks fire on the same event, their outputs are merged using event-specific strategies (see overview.md SS7.3). These examples show what happens when hooks produce conflicting outputs.

### Example A: BeforeToolSelection — NONE vs AUTO with allowed list

**Setup:** Two hooks fire on BeforeToolSelection.
- Hook 1 returns: `{ "hookSpecificOutput": { "toolConfig": { "mode": "NONE" } } }`
- Hook 2 returns: `{ "hookSpecificOutput": { "toolConfig": { "mode": "AUTO", "allowedFunctionNames": ["read_file", "search_file_content"] } } }`

**Result:** `NONE` wins (most-restrictive-wins rule). The `allowedFunctionNames` from Hook 2 are ignored. No tools are available for this request.

**Why:** The aggregator uses priority ordering: `NONE` > `ANY` > `AUTO`. If any hook says "no tools," that overrides all others. This prevents a permissive hook from overriding a security restriction.

### Example B: BeforeModel — sequential request override

**Setup:** Two hooks in a sequential group fire on BeforeModel.
- Hook 1 modifies `llm_request` to add a system message: `{ "hookSpecificOutput": { "llm_request": { "messages": [...original, { "role": "system", "content": "Be concise" }] } } }`
- Hook 2 modifies `llm_request` to change temperature: `{ "hookSpecificOutput": { "llm_request": { "config": { "temperature": 0.1 } } } }`

**Result (sequential):** Both modifications apply. Hook 1's output becomes Hook 2's input. The final request has the added system message AND the modified temperature.

**Result (parallel):** Field-replacement merge applies. Hook 2's `hookSpecificOutput.llm_request` shallow-merges over Hook 1's. If Hook 2 also included a `messages` field, it would override Hook 1's messages entirely. If it only included `config`, Hook 1's messages modification would be preserved via the shallow merge.

### Example C: BeforeTool — block-wins with multiple hooks

**Setup:** Three hooks fire on BeforeTool for `run_shell_command`.
- Hook 1 (dangerous command blocker): returns `{ "decision": "block", "reason": "Force push detected" }`
- Hook 2 (audit logger): returns `{ "decision": "allow" }` (just wants to log)
- Hook 3 (git checkpoint): returns `{ "decision": "allow" }`

**Result:** The operation is blocked. OR-decision logic means any single block wins. The block reason from Hook 1 is preserved. Hooks 2 and 3's allow decisions do not override the block.

---

## Appendix: Robustness & Multimodal Caveats

### Non-text content and translator lossiness

The hook translator (`HookTranslatorGenAIv1`) intentionally extracts **only text parts** from LLM requests and responses. Non-text content is silently dropped:

- **Images, audio, video parts** in `llm_request.messages` are filtered out. Hooks only see text messages.
- **Function call parts** (tool use requests/responses) are filtered out during translation.
- **Structured content** (e.g., `inlineData`, `fileData`) is dropped.

**Implications for hook authors:**
- If your BeforeModel hook modifies `llm_request.messages` and returns it, the round-trip through the translator will lose any non-text parts that were in the original request. The `fromHookLLMRequest()` method merges hook output with the original `baseRequest` to preserve non-text parts that the hook didn't touch, but any message the hook explicitly modifies will be text-only on the way back.
- AfterModel hooks that modify `llm_response` will similarly lose non-text response parts.
- This is an intentional v1 design decision. Future versions may expose additional content types.

### Handling large payloads

Hook scripts receive the full JSON payload on stdin. For large conversations (many messages, long tool outputs), this can be substantial:

```bash
# Good: Read stdin once into a variable, then process
INPUT=$(cat)
# ... use $INPUT multiple times ...

# Bad: Trying to read stdin multiple times (stdin is a stream, not seekable)
TOOL_NAME=$(cat | jq -r '.tool_name')  # Works
TOOL_INPUT=$(cat | jq -r '.tool_input')  # EMPTY — stdin already consumed!
```

For very large payloads, consider writing stdin to a temp file:
```bash
TMPFILE=$(mktemp)
cat > "$TMPFILE"
# ... process $TMPFILE with jq ...
rm -f "$TMPFILE"
```

### Handling malformed or unexpected JSON

Always validate that expected fields exist before using them:

```bash
INPUT=$(cat)

# Safe: Use jq's // operator for defaults
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty')

# Safe: Check field existence before branching
if echo "$INPUT" | jq -e '.tool_input.file_path' > /dev/null 2>&1; then
  FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path')
  # ... process file ...
fi
```

### Unicode and binary content

Tool inputs may contain arbitrary Unicode, including:
- Non-ASCII characters in file paths and content
- Embedded null bytes (rare, but possible in binary file reads)
- Very long lines without newlines

When using `grep` or `sed` on tool input content, be aware:
- Use `LC_ALL=C` for binary-safe matching
- Use `jq -r` (not `echo`) to preserve Unicode correctly
- Avoid `echo "$CONTENT" | grep` for content that might contain binary data; prefer `jq` selectors operating on the JSON directly

---

## Appendix: Common Patterns

### Minimal "always allow" hook (template)

```bash
#!/usr/bin/env bash
# Always allows, does nothing. Use as a starting template.
# Drain stdin (required — the runner writes JSON to stdin and closes it).
cat > /dev/null
echo '{}'
exit 0
```

> **WARNING: Common mistake:** Do NOT use bare `cat` without redirecting to `/dev/null`. A bare `cat` writes stdin to stdout, so the output would be the raw input JSON followed by `{}`, which is invalid JSON and will be treated as a `systemMessage` instead of parsed as a decision object.

### Minimal "always block" hook (template)

```bash
#!/usr/bin/env bash
echo '{"decision":"block","reason":"This operation is disabled by policy."}'
exit 0
```

### Minimal "block via exit code" hook (template)

```bash
#!/usr/bin/env bash
echo "Operation blocked by policy" >&2
exit 2
```

### Reading specific fields with jq

```bash
# Tool name
echo "$INPUT" | jq -r '.tool_name'

# File path (handles multiple field names)
echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.absolute_path // .tool_input.path // empty'

# Shell command
echo "$INPUT" | jq -r '.tool_input.command // empty'

# Model name
echo "$INPUT" | jq -r '.llm_request.model // empty'

# Number of messages in the conversation
echo "$INPUT" | jq '.llm_request.messages | length'

# The last user message
echo "$INPUT" | jq -r '.llm_request.messages | map(select(.role == "user")) | last | .content'

# Model response text
echo "$INPUT" | jq -r '.llm_response.text // empty'

# Whether tool succeeded
echo "$INPUT" | jq -r '.tool_response.error == null'
```

### Node.js stdin reading boilerplate

```javascript
#!/usr/bin/env node
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    // ... your logic here ...
    console.log(JSON.stringify({ decision: 'allow' }));
  } catch (err) {
    console.error(err.message);
    console.log('{}');
  }
});
```

### Combining multiple hooks on the same event

```jsonc
// Multiple hook groups on BeforeTool — all matching groups fire
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          { "type": "command", "command": ".llxprt/hooks/secret-scan.sh" },
          { "type": "command", "command": ".llxprt/hooks/protect-files.sh" }
        ]
      },
      {
        "matcher": "run_shell_command",
        "hooks": [
          { "type": "command", "command": ".llxprt/hooks/block-dangerous-commands.sh" }
        ]
      },
      {
        "matcher": "write_file|replace|run_shell_command",
        "hooks": [
          { "type": "command", "command": ".llxprt/hooks/git-checkpoint.sh" }
        ]
      }
    ]
  }
}
```

### Sequential hooks (output of one feeds into the next)

```jsonc
// Hooks in a group with "sequential: true" chain their outputs
{
  "hooks": {
    "BeforeModel": [
      {
        "sequential": true,
        "hooks": [
          { "type": "command", "command": ".llxprt/hooks/inject-context.sh" },
          { "type": "command", "command": ".llxprt/hooks/cost-control.sh" }
        ]
      }
    ]
  }
}
```

In this example, `inject-context.sh` modifies the `llm_request` (adds a system
message), and then `cost-control.sh` receives the *already-modified* request.
If `inject-context.sh` blocks (it doesn't, but hypothetically), `cost-control.sh`
would not run.
