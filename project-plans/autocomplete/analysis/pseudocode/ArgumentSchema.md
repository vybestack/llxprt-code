# Argument Schema & Resolver Pseudocode

<!-- @plan:PLAN-20250214-AUTOCOMPLETE.P02 @requirement:REQ-001 @requirement:REQ-002 @requirement:REQ-004 @requirement:REQ-005 @requirement:REQ-006 -->

**Lines 1-10**: Define types
1. `LiteralArgument` structure: `{ kind: 'literal', value: string, description?: string, next?: CommandArgumentSchema[] }`
2. `ValueArgument` structure: `{ kind: 'value', name: string, description?: string, options?: Option[], completer?: CompleterFn, hint?: HintFn | string, next?: CommandArgumentSchema[] }`
3. `Option` structure: `{ value: string, description?: string }`
4. `CompleterFn = (ctx: CommandContext, partial: string, tokens: TokenInfo) => Promise<Option[]>`
5. `HintFn = (ctx: CommandContext, tokens: TokenInfo) => Promise<string>`
6. `CommandArgumentSchema = (LiteralArgument | ValueArgument)[]`

**Lines 11-20**: Token utilities
7. `tokenize(fullLine: string): TokenInfo` – handles quotes, escapes, trailing spaces.
8. Returns `tokens: string[]`, `partialToken: string`, `hasTrailingSpace: boolean`.

**Lines 21-40**: Resolver algorithm `resolveContext(tokens, schema)`
9. Initialize `position = 0`, `nodeList = schema`.
10. For each token in `tokens`:
    - If `nodeList[position]` is literal, ensure token matches; follow `next` if present.
    - If value argument, increment position and record consumed value (for hint context).
    - If mismatch, break and mark context as invalid (return fallback hint).
11. Return `ResolvedContext` containing `activeNode`, `position`, `consumedValues`.

**Lines 41-60**: `generateSuggestions(ctx, partialToken)`
12. If `activeNode` is literal list: filter by `startsWith(partialToken)`.
13. If `activeNode` is value argument with `options`: filter options.
14. If `activeNode` is value argument with `completer`: await completer.
15. On error, log and return empty array.

**Lines 61-70**: `computeHint(ctx)`
16. If `activeNode.description`, use it.
17. Else if value argument with `hint` function/string, resolve it.
18. Else fallback to `activeNode.name`.

**Lines 71-90**: `createCompletionHandler(schema)`
19. Function `(commandContext, partialArg, fullLine)`:
    - Use `tokenize` (lines 7-8).
    - Call `resolveContext` (lines 9-11).
    - Resolve suggestions (lines 12-15).
    - Resolve hint (lines 16-18).
    - Return `{ suggestions: Option[], hint: string, position }`.
20. Ensure stable ordering and dedupe suggestions.

**Lines 91-110**: `/subagent` schema mapping
21. Arg0 value: name – completer lists existing subagents.
22. Arg1 value: profile – completer lists profiles.
23. Arg2 literal branch: auto/manual, each with `next` (prompt argument).
24. Arg3 value: prompt – hint depends on mode.

**Lines 111-130**: `/set` schema mapping (for migration phase)
25. Arg0 literal: `unset`, `modelparam`, `emojifilter`, etc.
26. Each literal provides `next` definitions for subsequent value arguments.
