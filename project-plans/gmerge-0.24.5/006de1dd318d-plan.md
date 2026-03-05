# Playbook: Add Security Documentation for Hooks

**Upstream SHA:** `006de1dd318d266c337a1ca5be4e27f4f3adc209`
**Upstream Subject:** Add security docs
**Upstream Stats:** 2 files, 199 insertions

## What Upstream Does

Adds comprehensive **security documentation** to the hooks feature, focusing on threat modeling and best practices. This commit:

1. **Reorganizes `docs/hooks/best-practices.md`:**
   - Moves existing "Security considerations" section to a new "Using Hooks Securely" section
   - Adds detailed **threat model** table explaining hook sources (System, User, Extensions, Project)
   - Documents **risks** (arbitrary code execution, data exfiltration, prompt injection)
   - Provides **mitigation strategies** (verify sources, sanitize env vars, use timeouts, limit permissions)
   - Separates "Authoring Secure Hooks" (for hook developers) from "Using Hooks Securely" (for end users)

2. **Updates `docs/hooks/index.md`:**
   - Adds **Security and Risks** warning section with clear callout about arbitrary code execution
   - Links to detailed threat model in best-practices.md

The documentation emphasizes that **project-level hooks** are particularly risky when opening third-party repos.

## LLxprt File Existence Map

**VERIFIED paths:**
- [OK] `docs/hooks/best-practices.md` (EXISTS, needs security sections)
- [OK] `docs/hooks/index.md` (EXISTS, needs security warning)

**Actions required:**
1. MODIFY: `docs/hooks/best-practices.md` (add ~150 lines of security content)
2. MODIFY: `docs/hooks/index.md` (add ~22 lines of security warning)

**LLxprt path differences:**
- `.gemini/settings.json` → `.llxprt/settings.json`
- `/etc/gemini-cli/` → `/etc/llxprt/` (or equivalent system config path)
- `GEMINI_API_KEY` → `LLXPRT_API_KEY`
- `GEMINI_PROJECT_DIR` → `LLXPRT_PROJECT_DIR`
- `Gemini CLI` → `LLxprt`

## Files to Modify

### 1. Update Hook Best Practices Doc
**File:** `docs/hooks/best-practices.md`

**Add new section after introduction (before existing sections):**

```markdown
## Using Hooks Securely

### Threat Model

Understanding where hooks come from and what they can do is critical for secure usage.

| Hook Source                   | Description                                                                                                                |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| **System**                    | Configured by system administrators (e.g., `/etc/llxprt/settings.json`). Assumed to be the **safest**. |
| **User** (`~/.llxprt/...`)    | Configured by you. You are responsible for ensuring they are safe.                                                         |
| **Extensions**                | You explicitly approve and install these. Security depends on the extension source (integrity).                            |
| **Project** (`./.llxprt/...`) | **Untrusted by default.** Safest in trusted internal repos; higher risk in third-party/public repos.                       |

#### Project Hook Security

When you open a project with hooks defined in `.llxprt/settings.json`:

1. **Detection**: LLxprt detects the hooks.
2. **Identification**: A unique identity is generated for each hook based on its `name` and `command`.
3. **Warning**: If this specific hook identity has not been seen before, a **warning** is displayed.
4. **Execution**: The hook is executed (unless specific security settings block it).
5. **Trust**: The hook is marked as "trusted" for this project.

> **IMPORTANT: Modification Detection** — If the `command` string of a project
> hook is changed (e.g., by a `git pull`), its identity changes. LLxprt will
> treat it as a **new, untrusted hook** and warn you again. This prevents
> malicious actors from silently swapping a verified command for a malicious
> one.

### Risks

| Risk                         | Description                                                                                                                          |
| :--------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **Arbitrary Code Execution** | Hooks run as your user. They can do anything you can do (delete files, install software).                                            |
| **Data Exfiltration**        | A hook could read your input (prompts), output (code), or environment variables (`LLXPRT_API_KEY`) and send them to a remote server. |
| **Prompt Injection**         | Malicious content in a file or web page could trick an LLM into running a tool that triggers a hook in an unexpected way.            |

### Mitigation Strategies

#### Verify the source

**Verify the source** of any project hooks or extensions before enabling them.

- For open-source projects, a quick review of the hook scripts is recommended.
- For extensions, ensure you trust the author or publisher (e.g., verified
  publishers, well-known community members).
- Be cautious with obfuscated scripts or compiled binaries from unknown sources.

#### Sanitize Environment

Hooks inherit the environment of the LLxprt process, which may include
sensitive API keys. LLxprt attempts to sanitize sensitive variables, but you
should be cautious.

- **Avoid printing environment variables** to stdout/stderr unless necessary.
- **Use `.env` files** to securely manage sensitive variables, ensuring they are
  excluded from version control.

**System Administrators:** You can enforce environment variable redaction by
default in the system configuration (e.g., `/etc/llxprt/settings.json`):

```json
{
  "security": {
    "environmentVariableRedaction": {
      "enabled": true,
      "blocked": ["MY_SECRET_KEY"],
      "allowed": ["SAFE_VAR"]
    }
  }
}
```

## Authoring Secure Hooks

When writing your own hooks, follow these practices to ensure they are robust
and secure.

### Validate all inputs

Never trust data from hooks without validation. Hook inputs often come from the
LLM or user prompts, which can be manipulated.

```bash
#!/usr/bin/env bash
input=$(cat)

# Validate JSON structure
if ! echo "$input" | jq empty 2>/dev/null; then
  echo "Invalid JSON input" >&2
  exit 1
fi

# Validate tool_name explicitly
tool_name=$(echo "$input" | jq -r '.tool_name // empty')
if [[ "$tool_name" != "write_file" && "$tool_name" != "read_file" ]]; then
  echo "Unexpected tool: $tool_name" >&2
  exit 1
fi
```

### Use timeouts

Prevent denial-of-service (hanging agents) by enforcing timeouts. LLxprt
defaults to 60 seconds, but you should set stricter limits for fast hooks.

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "fast-validator",
            "command": "./hooks/validate.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

### Limit permissions

Run hooks with minimal required permissions:

```bash
#!/usr/bin/env bash
# Don't run as root
if [ "$EUID" -eq 0 ]; then
  echo "Hook should not run as root" >&2
  exit 1
fi

# Check file permissions before writing
if [ -w "$file_path" ]; then
  # Safe to write
else
  echo "Insufficient permissions" >&2
  exit 1
fi
```

### Example: Secret Scanner

Use `BeforeTool` hooks to prevent committing sensitive data. This is a powerful
pattern for enhancing security in your workflow.

```javascript
const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*['"]?[a-zA-Z0-9_-]{20,}['"]?/i,
  /password\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/i,
  /secret\s*[:=]\s*['"]?[a-zA-Z0-9_-]{20,}['"]?/i,
  /AKIA[0-9A-Z]{16}/, // AWS access key
  /ghp_[a-zA-Z0-9]{36}/, // GitHub personal access token
  /sk-[a-zA-Z0-9]{48}/, // OpenAI API key
];

function containsSecret(content) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}
```
```

### 2. Add Security Warning to Hooks Index
**File:** `docs/hooks/index.md`

**Insert after introductory paragraphs, before "Core concepts" section:**

```markdown
## Security and Risks

> **WARNING: Hooks execute arbitrary code with your user privileges.**

By configuring hooks, you are explicitly allowing LLxprt to run shell
commands on your machine. Malicious or poorly configured hooks can:

- **Exfiltrate data**: Read sensitive files (`.env`, ssh keys) and send them to
  remote servers.
- **Modify system**: Delete files, install malware, or change system settings.
- **Consume resources**: Run infinite loops or crash your system.

**Project-level hooks** (in `.llxprt/settings.json`) and **Extension hooks** are
particularly risky when opening third-party projects or extensions from
untrusted authors. LLxprt will **warn you** the first time it detects a new
project hook (identified by its name and command), but it is **your
responsibility** to review these hooks (and any installed extensions) before
trusting them.

See [Security Considerations](best-practices.md#using-hooks-securely) for a
detailed threat model and mitigation strategies.
```

## Preflight Checks

**VERIFIED:**
- [OK] `docs/hooks/best-practices.md` exists
- [OK] `docs/hooks/index.md` exists

**Dependencies:**
- None (pure documentation)

**Verification Commands:**
```bash
# No build commands needed for docs
# Just verify no broken links:
grep -r "best-practices.md#using-hooks-securely" docs/hooks/
```

## Implementation Steps

1. **Update `docs/hooks/best-practices.md`:**
   - Insert "Using Hooks Securely" section (~150 lines)
   - Insert "Authoring Secure Hooks" section (~50 lines)
   - Replace all `Gemini CLI` → `LLxprt`
   - Replace all `.gemini/` → `.llxprt/`
   - Replace all `GEMINI_*` → `LLXPRT_*`
   - Replace all `/etc/gemini-cli/` → `/etc/llxprt/`

2. **Update `docs/hooks/index.md`:**
   - Insert "Security and Risks" section (~22 lines) after intro
   - Replace `Gemini CLI` → `LLxprt`
   - Replace `.gemini/` → `.llxprt/`
   - Verify link to `best-practices.md#using-hooks-securely` works

3. **Manual review:**
   - Read through both docs to ensure coherence
   - Check that all cross-references work
   - Verify all code examples are valid

4. **No code changes, no tests** — documentation only

## Execution Notes

- **Batch group:** Hooks-Security-Docs
- **Dependencies:** None (but assumes hooks feature exists)
- **Verification:** Manual review of docs, check for broken links
- **Risk:** Very low — documentation only
- **Critical gotcha:** Must replace ALL Gemini branding with LLxprt equivalents:
  - `Gemini CLI` → `LLxprt`
  - `.gemini/` → `.llxprt/`
  - `GEMINI_API_KEY` → `LLXPRT_API_KEY`
  - `GEMINI_PROJECT_DIR` → `LLXPRT_PROJECT_DIR`
  - `/etc/gemini-cli/` → `/etc/llxprt/` (or system config path)
- **User impact:** High value — users get clear guidance on hook security, especially important given arbitrary code execution risk
- **Scope:** Pure documentation, ~199 lines added across 2 files
