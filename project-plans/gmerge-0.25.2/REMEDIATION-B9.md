# Remediation Plan: B9 - Hooks Docs Branding (REVISED)

## Discovery Phase (Required First)

### Full Repository Search
```bash
# Branding tokens to find and classify
echo "=== Branding Tokens ==="
rg -n "Gemini CLI" docs/
rg -n "> gemini" docs/
rg -ni "gemini.*skill|skill.*gemini" docs/

echo "=== Env Vars ==="
rg -n "GEMINI_" docs/

echo "=== Paths ==="
rg -n "\.gemini/" docs/
rg -n "gemini-extension" docs/

echo "=== Context Check ==="
# Determine if each hit is:
# 1. Product branding (CHANGE to LLxprt)
# 2. Compatibility documentation (KEEP with clarification)
# 3. Upstream reference (EVALUATE)
```

## File-by-File Remediation

### docs/hooks/index.md
**Change:** Section heading only
```diff
- ## From Gemini CLI
+ ## From LLxprt Code
```

### docs/hooks/writing-hooks.md
**Audit each GEMINI_ variable:**
- `GEMINI_API_KEY` → If documenting LLxprt's own env var: `LLXPRT_API_KEY`
- `GEMINI_SESSION_ID` → If LLxprt native: `LLXPRT_SESSION_ID`
- `GEMINI_PROJECT_DIR` → If LLxprt native: `LLXPRT_PROJECT_DIR`
- **BUT** if documenting "for compatibility with Gemini CLI, these env vars are also read" → KEEP with clarification

**Example format:**
```markdown
LLxprt Code reads the following environment variables:
- `LLXPRT_API_KEY` - Primary API key
- `GEMINI_API_KEY` - Fallback for Gemini CLI compatibility
```

**Change:**
```diff
- > gemini
+ > llxprt
```

### docs/extension.md
**Change:** Make primary, document fallback
```diff
- The extension manifest should be in `gemini-extension.json`.
+ The extension manifest should be in `llxprt-extension.json`.
+ For backward compatibility with Gemini CLI extensions, `gemini-extension.json` is also supported as a fallback.
```

### Path References
**Change:** Primary path, document old
```diff
- Configuration is stored in `.gemini/`.
+ Configuration is stored in `.llxprt/` (previously `.gemini/` for compatibility).
```

## Preservation Checklist

After edits, verify:
- [ ] No behavioral instructions removed
- [ ] Compatibility notes preserved where relevant
- [ ] All factual content about hook behavior retained
- [ ] Examples still work with new env var names

## Final Verification
```bash
# Should show only intentional compatibility references
rg -ni "gemini|GEMINI_|\.gemini|gemini-extension" docs/ | grep -v "compatibility\|fallback\|also supported"
```
