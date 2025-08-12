# Phase 3: Format Detector Stub Implementation

## Objective

Create minimal skeleton of ToolFormatDetector that compiles with empty implementations.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Create stub implementation of ToolFormatDetector.

UPDATE packages/core/src/providers/openai/toolFormats/types.ts:
(Create if doesn't exist, otherwise ADD to existing)
- Define ToolFormat type: 'auto' | 'openai' | 'qwen' | 'gemini'
- Define FormatDetectionResult interface
- Define IToolFormatStrategy interface
- Export all types

UPDATE packages/core/src/providers/openai/toolFormats/ToolFormatDetector.ts:
(Create if doesn't exist, otherwise MODIFY existing)
- Class with detectFormat method
- Method getStrategy
- All methods have EMPTY BODIES returning dummy values:
  - detectFormat: return { detectedFormat: 'openai', source: 'default', confidence: 0 }
  - getStrategy: return {} as any
- Include TypeScript types
- Maximum 50 lines

Requirements:
1. Must compile with strict TypeScript
2. NO 'NotYetImplemented' throws - empty implementations only
3. Include all methods from specification
4. Tests will fail naturally with empty implementations

CRITICAL: No error throwing. Let tests fail naturally.

Output status to workers/phase-03.json
"
```

## Verification

```bash
# Check compilation
npm run typecheck

# Verify NO NotYetImplemented or stub markers
grep -r "NotYetImplemented\|not.*implemented\|TODO\|stub" packages/core/src/providers/openai/toolFormats/
if [ $? -eq 0 ]; then
  echo "FAIL: Found stub markers"
  exit 1
fi

# Check minimal implementation
wc -l packages/core/src/providers/openai/toolFormats/ToolFormatDetector.ts
# Should be < 50 lines
```