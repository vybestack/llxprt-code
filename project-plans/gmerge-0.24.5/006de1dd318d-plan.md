# Playbook: Add Security Documentation for Hooks

**Upstream SHA:** `006de1dd318d266c337a1ca5be4e27f4f3adc209`
**Upstream Subject:** Add security docs
**Upstream Stats:** 2 files, 199 insertions

## What Upstream Does

Adds comprehensive **security documentation** to the hooks feature, focusing on threat modeling and best practices. This commit:

1. **Reorganizes `docs/hooks/best-practices.md`:**
   - Moves the "Security considerations" section (128 lines) to a new section called "Using Hooks Securely"
   - Adds a detailed **threat model** table explaining hook sources (System, User, Extensions, Project)
   - Documents **risks** (arbitrary code execution, data exfiltration, prompt injection)
   - Provides **mitigation strategies** (verify sources, sanitize env vars, use timeouts, limit permissions)
   - Clarifies that "Authoring Secure Hooks" is for hook developers, while "Using Hooks Securely" is for end users

2. **Updates `docs/hooks/index.md`:**
   - Adds a **Security and Risks** warning section (22 lines) with a clear callout about arbitrary code execution
   - Links to the detailed threat model in best-practices.md

The documentation emphasizes that **project-level hooks** are particularly risky when opening third-party repos, and that Gemini CLI warns about new hooks but cannot fully protect users.

## LLxprt Adaptation Strategy

LLxprt **has hooks** (confirmed by docs structure), so this security documentation is directly applicable. The changes are:

1. **Pure documentation** — no code changes
2. **Content is platform-agnostic** — just replace "Gemini CLI" with "LLxprt" and `GEMINI_*` env vars with `LLXPRT_*`
3. **Check if LLxprt docs structure matches upstream** — if not, adapt section placement

### Key Adaptations

- Replace `GEMINI_CLI_` with `LLXPRT_`
- Replace `GEMINI_API_KEY` with `LLXPRT_API_KEY` (or whatever LLxprt uses)
- Replace `GEMINI_PROJECT_DIR` with the equivalent LLxprt env var
- Update references to settings paths (`/etc/gemini-cli/` → `/etc/llxprt/` or similar)
- Keep all threat model tables and security warnings verbatim

## Files to Create/Modify

### 1. Reorganize Hook Best Practices Doc
**File:** `docs/hooks/best-practices.md` (or LLxprt equivalent)

**Changes:**
- **Move** the existing "Security considerations" section (if it exists) to a new location
- **Add** new section: "Using Hooks Securely" (150+ lines)
  - Subsections:
    - **Threat Model** (table explaining hook sources)
    - **Project Hook Security** (how detection works, identity tracking)
    - **Risks** (table of attack vectors)
    - **Mitigation Strategies** (verify sources, sanitize env, etc.)
- **Add** new section: "Authoring Secure Hooks" (50 lines)
  - Subsections:
    - Validate all inputs
    - Use timeouts
    - Limit permissions
    - Example: Secret Scanner
- **Keep** existing sections:
  - Performance
  - Debugging
  - Privacy considerations

**Upstream content (lines 7-202 of diff):**
```markdown
## Using Hooks Securely

### Threat Model

Understanding where hooks come from and what they can do is critical for secure usage.

| Hook Source                   | Description                                                                                                                |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| **System**                    | Configured by system administrators (e.g., `/etc/gemini-cli/settings.json`, `/Library/...`). Assumed to be the **safest**. |
| **User** (`~/.gemini/...`)    | Configured by you. You are responsible for ensuring they are safe.                                                         |
| **Extensions**                | You explicitly approve and install these. Security depends on the extension source (integrity).                            |
| **Project** (`./.gemini/...`) | **Untrusted by default.** Safest in trusted internal repos; higher risk in third-party/public repos.                       |

#### Project Hook Security

When you open a project with hooks defined in `.gemini/settings.json`:

1. **Detection**: Gemini CLI detects the hooks.
2. **Identification**: A unique identity is generated for each hook based on its `name` and `command`.
3. **Warning**: If this specific hook identity has not been seen before, a **warning** is displayed.
4. **Execution**: The hook is executed (unless specific security settings block it).
5. **Trust**: The hook is marked as "trusted" for this project.

> [!IMPORTANT] **Modification Detection**: If the `command` string of a project
> hook is changed (e.g., by a `git pull`), its identity changes. Gemini CLI will
> treat it as a **new, untrusted hook** and warn you again. This prevents
> malicious actors from silently swapping a verified command for a malicious
> one.

### Risks

| Risk                         | Description                                                                                                                          |
| :--------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **Arbitrary Code Execution** | Hooks run as your user. They can do anything you can do (delete files, install software).                                            |
| **Data Exfiltration**        | A hook could read your input (prompts), output (code), or environment variables (`GEMINI_API_KEY`) and send them to a remote server. |
| **Prompt Injection**         | Malicious content in a file or web page could trick an LLM into running a tool that triggers a hook in an unexpected way.            |

### Mitigation Strategies

#### Verify the source

**Verify the source** of any project hooks or extensions before enabling them.

- For open-source projects, a quick review of the hook scripts is recommended.
- For extensions, ensure you trust the author or publisher (e.g., verified
  publishers, well-known community members).
- Be cautious with obfuscated scripts or compiled binaries from unknown sources.

#### Sanitize Environment

Hooks inherit the environment of the Gemini CLI process, which may include
sensitive API keys. Gemini CLI attempts to sanitize sensitive variables, but you
should be cautious.

- **Avoid printing environment variables** to stdout/stderr unless necessary.
- **Use `.env` files** to securely manage sensitive variables, ensuring they are
  excluded from version control.

**System Administrators:** You can enforce environment variable redaction by
default in the system configuration (e.g., `/etc/gemini-cli/settings.json`):

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

Prevent denial-of-service (hanging agents) by enforcing timeouts. Gemini CLI
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
            "timeout": 5000 // 5 seconds
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

**LLxprt adaptation:**
- Replace `Gemini CLI` → `LLxprt`
- Replace `/etc/gemini-cli/settings.json` → `/etc/llxprt/settings.json` (or whatever)
- Replace `GEMINI_API_KEY` → `LLXPRT_API_KEY` (or equivalent)
- Keep all tables and code examples verbatim

### 2. Add Security Warning to Hooks Index
**File:** `docs/hooks/index.md` (or LLxprt equivalent)

**Changes:**
- **Add** new section after the introductory paragraphs (before "Core concepts")
- Insert 22 lines of security warnings

**Upstream content (lines 30-51 of diff):**
```markdown
## Security and Risks

> [!WARNING] **Hooks execute arbitrary code with your user privileges.**

By configuring hooks, you are explicitly allowing Gemini CLI to run shell
commands on your machine. Malicious or poorly configured hooks can:

- **Exfiltrate data**: Read sensitive files (`.env`, ssh keys) and send them to
  remote servers.
- **Modify system**: Delete files, install malware, or change system settings.
- **Consume resources**: Run infinite loops or crash your system.

**Project-level hooks** (in `.gemini/settings.json`) and **Extension hooks** are
particularly risky when opening third-party projects or extensions from
untrusted authors. Gemini CLI will **warn you** the first time it detects a new
project hook (identified by its name and command), but it is **your
responsibility** to review these hooks (and any installed extensions) before
trusting them.

See [Security Considerations](best-practices.md#using-hooks-securely) for a
detailed threat model and mitigation strategies.
```

**LLxprt adaptation:**
- Replace `Gemini CLI` → `LLxprt`
- Replace `.gemini/settings.json` → `.llxprt/settings.json` (or whatever LLxprt uses)
- Keep all risk descriptions verbatim

## Implementation Steps

1. **Check LLxprt hooks docs structure:**
   - Verify that `docs/hooks/best-practices.md` and `docs/hooks/index.md` exist
   - If they don't, this commit may need to be deferred until hooks docs are added

2. **Update `docs/hooks/best-practices.md`:**
   - **Remove** old "Security considerations" section (if it exists)
   - **Add** new section "Using Hooks Securely" (150 lines) after the intro
   - **Add** new section "Authoring Secure Hooks" (50 lines) before "Privacy considerations"
   - Replace all `Gemini CLI` → `LLxprt`
   - Replace all `GEMINI_*` env vars with `LLXPRT_*` equivalents
   - Replace `/etc/gemini-cli/` → `/etc/llxprt/` (or system config path)

3. **Update `docs/hooks/index.md`:**
   - **Insert** "Security and Risks" section (22 lines) after intro, before "Core concepts"
   - Replace `Gemini CLI` → `LLxprt`
   - Replace `.gemini/` → `.llxprt/` (or project config path)
   - Update link: `best-practices.md#using-hooks-securely`

4. **Review and adapt examples:**
   - The bash and JavaScript examples are platform-agnostic — no changes needed
   - The JSON config examples are also generic

5. **Manual review:**
   - Read through the entire security section to ensure it makes sense for LLxprt
   - Check that all cross-references work (e.g., links to other doc sections)

6. **No code changes, no tests** — this is pure documentation

## Execution Notes

- **Batch group:** Security
- **Dependencies:** None (but assumes hooks feature exists)
- **Verification:** `npm run docs:build` (if applicable) — ensure no broken links
- **Estimated magnitude:** Small — 2 files, 199 lines of docs
- **Risk:** Very low — documentation only
- **Critical gotcha:** Must replace all `Gemini CLI` and `GEMINI_*` references with LLxprt equivalents. Do NOT copy-paste verbatim.
- **User impact:** High value — users will have clear guidance on hook security. This is especially important given the arbitrary code execution risk.
