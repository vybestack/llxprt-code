# Remediation Plan: COPYRIGHT - Fix Copyright Headers (READY)

## Decision Matrix (Final)

| File Status | Copyright Action | How to Verify |
|-------------|------------------|---------------|
| ADDED in this branch, no upstream equivalent | `Copyright Vybestack LLC, 2026` | `git log --all -- source_file` shows no history |
| MODIFIED from upstream, >30% new code | Keep Google + Add Vybestack | Calculation below |
| From upstream, unchanged | Keep Google | No diff from main |

### 30% Calculation
```bash
# For each modified file:
upstream_lines=$(git show main:"$file" 2>/dev/null | wc -l)
changed_lines=$(git diff main...gmerge/0.25.2 -- "$file" | grep -E "^[+-]" | grep -v "^[+-]{3}" | wc -l)

if [ "$upstream_lines" -gt 0 ]; then
  percent=$((changed_lines * 100 / upstream_lines))
  if [ "$percent" -gt 30 ]; then
    echo "$file: ADD Vybestack copyright"
  fi
fi
```

## Discovery

```bash
# Get all changed files
git diff --name-status main...gmerge/0.25.2 > /tmp/changes.txt

# New files (need Vybestack)
grep "^A" /tmp/changes.txt | cut -f2 > /tmp/new-files.txt

# Modified files (check 30% rule)
grep "^M" /tmp/changes.txt | cut -f2 > /tmp/modified-files.txt
```

## Copyright Headers

### New Files
```typescript
/**
 * Copyright Vybestack LLC, 2026
 * SPDX-License-Identifier: Apache-2.0
 */
```

### Substantially Modified Files  
```typescript
/**
 * Copyright Google LLC, 2024
 * Copyright Vybestack LLC, 2026
 * SPDX-License-Identifier: Apache-2.0
 */
```

## Specific Files to Fix

### B30 - textUtils.test.ts
**Status:** NEW file (added in this branch)
**Current:** Google LLC
**Required:** Vybestack LLC

### Other Files to Check
Run this to find all files needing changes:
```bash
# New files with Google copyright (should be changed)
while IFS= read -r f; do
  if [ -f "$f" ] && grep -q "Google LLC" "$f"; then
    echo "CHANGE: $f"
  fi
done < /tmp/new-files.txt
```

## Validation

```bash
# Verify no new files have Google
echo "=== Checking new files ==="
while IFS= read -r f; do
  if [ -f "$f" ] && grep -q "Google LLC" "$f" 2>/dev/null; then
    echo "ERROR: $f has Google copyright (should be Vybestack)"
  fi
done < /tmp/new-files.txt

# Verify new files have Vybestack
echo "=== New files with Vybestack ==="
while IFS= read -r f; do
  if [ -f "$f" ] && grep -q "Vybestack LLC" "$f" 2>/dev/null; then
    echo "OK: $f"
  fi
done < /tmp/new-files.txt
```
