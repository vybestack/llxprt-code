# Loop Detection Improvement Proposal

## Current Implementation Issues

The current loop detection system has several drawbacks:
1. Uses a separate LLM call with a complex diagnostic prompt
2. Not transparent to the user about what's happening
3. Overly complex for what should be a simple intervention
4. Can trigger false positives in legitimate repetitive operations

## Proposed Simplified Approach

Instead of a separate diagnostic agent, we could implement a simpler notification system:

1. **Pattern Detection**: Keep the existing detection of repetitive tool calls and content patterns
2. **Direct Notification**: When a pattern is detected, inject a simple notification into the conversation:
   ```
   SYSTEM: I've noticed you've called [tool_name] [n] times in a row with similar parameters. Consider changing your approach or confirming if this repetition is intentional.
   ```
3. **Actionable Guidance**: Provide specific suggestions based on the detected pattern:
   - For tool repetition: "Try a different approach or verify if you're making progress"
   - For content repetition: "Consider advancing to the next step or summarizing what you've learned"

## Benefits

- More efficient (no additional LLM calls)
- More transparent to users
- More actionable feedback
- Reduced chance of false positives interrupting legitimate workflows

## Implementation Plan

1. Modify the LoopDetectionService to generate simple notifications instead of LLM analysis
2. Add clear documentation about when and why these notifications appear
3. Add configuration options to adjust sensitivity or disable for specific use cases
4. Preserve the existing detailed detection logic but change how it's presented to the model

## Next Steps

- Review with the team
- Implement prototype
- Test with various conversation patterns
- Measure effectiveness vs. current approach