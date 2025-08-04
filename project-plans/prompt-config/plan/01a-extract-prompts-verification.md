# Task 01a: Verify Prompt Extraction

## Objective

Adversarially verify that prompt extraction was completed correctly, with all content properly categorized and no content lost or duplicated.

## Context

This verification task runs after 01-extract-prompts.md to ensure the extraction was done properly. The verifier should be skeptical and thorough.

## Verification Checklist

### 1. Directory Structure Verification

```bash
# Verify all required directories exist
test -d packages/core/src/prompt-config/defaults || echo "FAIL: defaults directory missing"
test -d packages/core/src/prompt-config/defaults/env || echo "FAIL: env directory missing"
test -d packages/core/src/prompt-config/defaults/tools || echo "FAIL: tools directory missing"
test -d packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-2.5-flash || echo "FAIL: flash directory missing"
```

### 2. File Existence Verification

```bash
# Core files
test -f packages/core/src/prompt-config/defaults/core.md || echo "FAIL: core.md missing"
test -f packages/core/src/prompt-config/defaults/env/git-repository.md || echo "FAIL: git-repository.md missing"
test -f packages/core/src/prompt-config/defaults/env/sandbox.md || echo "FAIL: sandbox.md missing"
test -f packages/core/src/prompt-config/defaults/env/ide-mode.md || echo "FAIL: ide-mode.md missing"

# Tool files - verify all from tool-naming-mapping.md
for tool in shell read-file edit write-file grep glob ls read-many-files web-fetch web-search memory todo-write todo-read; do
  test -f packages/core/src/prompt-config/defaults/tools/${tool}.md || echo "FAIL: ${tool}.md missing"
done

# Provider overrides
test -f packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-2.5-flash/core.md || echo "FAIL: flash core.md missing"
```

### 3. Content Verification

#### Check for Empty Files
```bash
# No file should be empty
find packages/core/src/prompt-config/defaults -name "*.md" -empty | while read f; do
  echo "FAIL: Empty file: $f"
done
```

#### Verify Content Extraction
```bash
# Check that core.md contains expected content
grep -q "You are Claude" packages/core/src/prompt-config/defaults/core.md || echo "FAIL: core.md missing main prompt"

# Check environment files have correct content
grep -q "sandbox" packages/core/src/prompt-config/defaults/env/sandbox.md || echo "FAIL: sandbox.md missing sandbox content"
grep -q "git" packages/core/src/prompt-config/defaults/env/git-repository.md || echo "FAIL: git-repository.md missing git content"

# Check Flash-specific content
grep -q "directly use the tool" packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-2.5-flash/core.md || echo "FAIL: Flash override missing tool usage instruction"
```

### 4. Content Duplication Check

```bash
# Check for duplicated content between files
# Flash-specific content should ONLY be in the flash override
grep -l "directly use the tool" packages/core/src/prompt-config/defaults/**/*.md | wc -l | grep -q "1" || echo "FAIL: Flash content duplicated in multiple files"
```

### 5. Original Source Comparison

Compare total content size to ensure nothing was lost:
```bash
# Get size of original prompts.ts content
ORIGINAL_SIZE=$(grep -A 1000 "export function getCoreSystemPrompt" packages/core/src/core/prompts.ts | wc -c)

# Get size of all extracted files
EXTRACTED_SIZE=$(find packages/core/src/prompt-config/defaults -name "*.md" -exec cat {} \; | wc -c)

# Should be reasonably close (within 10% accounting for file structure)
echo "Original size: $ORIGINAL_SIZE"
echo "Extracted size: $EXTRACTED_SIZE"
```

### 6. Tool Instruction Verification

Verify each tool has appropriate instructions:
```bash
# Each tool file should have some content about that specific tool
grep -q "shell\|bash\|command" packages/core/src/prompt-config/defaults/tools/shell.md || echo "FAIL: shell.md missing shell content"
grep -q "read\|file" packages/core/src/prompt-config/defaults/tools/read-file.md || echo "FAIL: read-file.md missing read content"
# ... check each tool
```

### 7. Format Preservation Check

```bash
# Check that code blocks were preserved
grep -q '```' packages/core/src/prompt-config/defaults/core.md || echo "WARNING: No code blocks found in core.md"

# Check that markdown formatting exists
grep -q '^#' packages/core/src/prompt-config/defaults/core.md || echo "WARNING: No headers found in core.md"
```

## Fraud Detection

Look for signs of lazy or incorrect extraction:

1. **Over-extraction**: Putting all content in core.md instead of proper categorization
2. **Under-extraction**: Missing sections that should have been extracted
3. **Wrong categorization**: Git content in sandbox.md, etc.
4. **Stub files**: Files created with placeholder content
5. **Format corruption**: Lost markdown formatting or code blocks

## Report Requirements

Create a verification report that includes:
1. Total files created
2. Any missing files
3. Any empty files
4. Any suspected incorrect categorization
5. Recommendation: PASS or FAIL with specific issues

## Success Criteria

- All required files exist
- No empty files
- Content properly categorized
- No duplication of provider-specific content
- Original formatting preserved
- Total content size reasonable compared to source