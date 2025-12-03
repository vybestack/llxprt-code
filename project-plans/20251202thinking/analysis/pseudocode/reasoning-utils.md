# Pseudocode: reasoningUtils.ts

## Interface Contracts

```typescript
// INPUTS
interface IContent {
  speaker: 'human' | 'ai' | 'tool';
  blocks: ContentBlock[];
}

interface ThinkingBlock {
  type: 'thinking';
  thought: string;
  isHidden?: boolean;
  sourceField?: 'reasoning_content' | 'thinking' | 'thought';
  signature?: string;
}

// OUTPUTS
type StripPolicy = 'all' | 'allButLast' | 'none';

// DEPENDENCIES (injected or imported)
// - tokenizer from existing token estimation module
```

## extractThinkingBlocks

```
10: FUNCTION extractThinkingBlocks(content: IContent): ThinkingBlock[]
11:   INITIALIZE result as empty array
12:   FOR EACH block IN content.blocks
13:     IF block.type === 'thinking'
14:       PUSH block TO result
15:     END IF
16:   END FOR
17:   RETURN result
18: END FUNCTION
```

## filterThinkingForContext

```
30: FUNCTION filterThinkingForContext(contents: IContent[], policy: StripPolicy): IContent[]
31:   IF policy === 'none'
32:     RETURN contents unchanged
33:   END IF
34:
35:   IF policy === 'all'
36:     RETURN contents with all ThinkingBlocks removed from each IContent
37:   END IF
38:
39:   IF policy === 'allButLast'
40:     FIND lastContentWithThinking = last IContent in contents that has ThinkingBlock
41:     FOR EACH content IN contents
42:       IF content === lastContentWithThinking
43:         KEEP ThinkingBlocks in this content
44:       ELSE
45:         REMOVE ThinkingBlocks from this content
46:       END IF
47:     END FOR
48:     RETURN modified contents
49:   END IF
50: END FUNCTION
```

## removeThinkingFromContent (helper)

```
60: FUNCTION removeThinkingFromContent(content: IContent): IContent
61:   RETURN new IContent with:
62:     speaker: content.speaker
63:     blocks: content.blocks FILTERED to exclude type === 'thinking'
64:     metadata: content.metadata
65: END FUNCTION
```

## thinkingToReasoningField

```
70: FUNCTION thinkingToReasoningField(blocks: ThinkingBlock[]): string | undefined
71:   IF blocks.length === 0
72:     RETURN undefined
73:   END IF
74:
75:   CONCATENATE all block.thought with newline separator
76:   RETURN concatenated string
77: END FUNCTION
```

## estimateThinkingTokens

```
80: FUNCTION estimateThinkingTokens(blocks: ThinkingBlock[]): number
81:   INITIALIZE total = 0
82:   FOR EACH block IN blocks
83:     total = total + estimateTokensForText(block.thought)
84:   END FOR
85:   RETURN total
86: END FUNCTION
```

## getEffectiveTokenCount

```
90: FUNCTION getEffectiveTokenCount(contents: IContent[], settings: EphemeralSettings): number
91:   GET stripPolicy from settings['reasoning.stripFromContext'] OR 'none'
92:   GET includeInContext from settings['reasoning.includeInContext'] OR false
93:
94:   APPLY stripPolicy using filterThinkingForContext
95:
96:   IF NOT includeInContext
97:     REMOVE all remaining ThinkingBlocks
98:   END IF
99:
100:  ESTIMATE tokens for filtered contents
101:  RETURN total token estimate
102: END FUNCTION
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Return [] when blocks exist  // Empty array fraud
[OK] DO: Return actual extracted blocks

[ERROR] DO NOT: Ignore stripPolicy parameter  // Skip logic
[OK] DO: Apply full filter logic based on policy

[ERROR] DO NOT: Use hardcoded token estimates  // Fake estimation
[OK] DO: Use actual tokenizer from existing module

[ERROR] DO NOT: Mutate input contents array  // Side effects
[OK] DO: Return new array with filtered contents
```
