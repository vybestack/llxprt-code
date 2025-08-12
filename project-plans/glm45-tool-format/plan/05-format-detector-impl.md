# Phase 5: Format Detector Implementation

## Objective

Implement ToolFormatDetector to pass all behavioral tests by following pseudocode exactly.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Implement ToolFormatDetector to pass all tests by following pseudocode.

Update packages/core/src/providers/openai/toolFormats/ToolFormatDetector.ts:

MANDATORY: Follow analysis/pseudocode/tool-format-detector.md EXACTLY:

1. Constructor (from pseudocode lines 5-10):
   - INITIALIZE modelPatterns Map
   - ADD /^qwen/i → 'qwen'
   - ADD /^glm-4\.5/i → 'qwen'  // GLM-4.5 uses Qwen format
   - ADD /^gpt/i → 'openai'
   - ADD /^claude/i → 'openai'

2. detectFormat method (from pseudocode lines 12-32):
   // Check explicit setting first (lines 13-18)
   - IF settings?.toolFormat AND settings.toolFormat != 'auto'
     - RETURN {
         format: settings.toolFormat,
         source: 'explicit-setting',
         confidence: 1.0
       }
   
   // Check model patterns (lines 20-27)
   - FOR EACH pattern IN modelPatterns
     - IF pattern.test(model)
       - RETURN {
           format: modelPatterns.get(pattern),
           source: 'model-pattern',
           confidence: 0.9
         }
   
   // Default to OpenAI (lines 29-32)
   - RETURN {
       format: 'openai',
       source: 'default',
       confidence: 0.5
     }

3. getStrategy method (from pseudocode lines 34-39):
   - SWITCH format
     - CASE 'qwen': RETURN new QwenFormatStrategy()
     - CASE 'openai': RETURN new OpenAIFormatStrategy()
     - CASE 'gemini': RETURN new GeminiFormatStrategy()
     - DEFAULT: RETURN new OpenAIFormatStrategy()

Requirements:
1. Do NOT modify tests
2. Follow pseudocode algorithm step-by-step
3. Use Map for modelPatterns as specified
4. Case-insensitive regex patterns (/i flag)
5. Return exact confidence values from pseudocode
6. Performance must be < 1ms

Run tests to verify:
npm test packages/core/test/providers/openai/toolFormats/ToolFormatDetector.spec.ts

Output status to workers/phase-05.json with:
- tests_passed: number
- tests_failed: number
- pseudocode_followed: boolean
- performance_ms: number
"
```

## Verification

```bash
# All tests pass
npm test ToolFormatDetector.spec.ts || exit 1

# Verify pseudocode was followed
claude --dangerously-skip-permissions -p "
Compare packages/core/src/providers/openai/toolFormats/ToolFormatDetector.ts
with analysis/pseudocode/tool-format-detector.md

Check:
1. modelPatterns initialized as Map with 5 patterns
2. detectFormat checks settings first (explicit before patterns)
3. Pattern matching loop implemented as specified
4. Default return values match pseudocode
5. getStrategy switch statement matches

Report deviations to verification-report.txt
"

# No stubs remain
grep "NotYetImplemented" ToolFormatDetector.ts
[ $? -ne 0 ] || echo "FAIL: Stubs remain"

# Performance check
node -e "
const { ToolFormatDetector } = require('./packages/core/dist/providers/openai/toolFormats/ToolFormatDetector.js');
const detector = new ToolFormatDetector();
const start = Date.now();
for(let i=0; i<10000; i++) {
  detector.detectFormat('glm-4.5', {});
}
const time = (Date.now() - start) / 10000;
console.log('Avg time:', time, 'ms');
if(time > 1) process.exit(1);
"

# Run mutation testing
npx stryker run --mutate packages/core/src/providers/openai/toolFormats/ToolFormatDetector.ts
MUTATION_SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
[ $(echo "$MUTATION_SCORE >= 80" | bc) -eq 1 ] || echo "FAIL: Mutation score below 80%"
```