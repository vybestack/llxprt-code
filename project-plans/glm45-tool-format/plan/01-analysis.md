# Phase 1: Domain Analysis

## Objective

Analyze tool format domain to understand format variations and detection strategies.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Read specification at project-plans/glm45-tool-format/specification.md.
Analyze the tool format domain and create comprehensive domain model.

Create analysis/domain-model.md with:

1. Entity Relationships:
   - ToolFormatDetector → FormatStrategy (1:1)
   - OpenAIProvider → ToolFormatDetector (1:1)
   - FormatStrategy → Tool Transformation (1:N)
   - Settings → Format Override (0:1)

2. Format Detection Flow:
   - Check explicit settings.toolFormat
   - If 'auto', check model patterns
   - Match GLM-4.5 → Qwen format
   - Match qwen* → Qwen format
   - Default → OpenAI format

3. Business Rules:
   - Explicit settings override auto-detection
   - GLM-4.5 models always use Qwen format unless overridden
   - Format detection must be deterministic
   - Same model + settings = same format
   - Format strategies must be stateless

4. Tool Format Differences:
   - OpenAI: Nested {type: 'function', function: {...}}
   - Qwen: Flat {name, description, parameters}
   - Response parsing varies by format
   - Error handling differs per format

5. Edge Cases:
   - Unknown model with no settings → OpenAI default
   - Invalid format in settings → Ignore, use auto
   - Model name variations (glm-4.5, GLM-4.5, glm45)
   - Mixed case handling in settings
   - Future format additions

6. Migration Scenarios:
   - Existing Qwen configs continue working
   - New GLM-4.5 auto-detects correctly
   - Manual overrides respected
   - Backwards compatibility maintained

Do NOT write implementation code, only analysis.
"
```

## Verification Checklist

- [ ] Format variations documented
- [ ] Detection flow diagram included
- [ ] Model patterns listed
- [ ] Edge cases comprehensive
- [ ] No implementation details