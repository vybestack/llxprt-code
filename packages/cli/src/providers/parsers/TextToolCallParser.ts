export interface TextToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ITextToolCallParser {
  parse(content: string): {
    cleanedContent: string;
    toolCalls: TextToolCall[];
  };
}

export class GemmaToolCallParser implements ITextToolCallParser {
  // Support multiple tool call formats
  private readonly patterns = [
    // Format 1: [TOOL_REQUEST] toolName {args} [TOOL_REQUEST_END]
    /\[TOOL_REQUEST\]\s*(\w+)\s+({.*?})\s*\[TOOL_REQUEST_END\]/gs,
    // Format 2: ✦ tool_call: toolName for key value pairs
    /✦\s*tool_call:\s*(\w+)\s+for\s+(.+?)(?=✦|$)/gs,
    // Format 3: Simple function call format
    /(\w+)\s*\(({.*?})\)/gs
  ];

  parse(content: string): {
    cleanedContent: string;
    toolCalls: TextToolCall[];
  } {
    const toolCalls: TextToolCall[] = [];
    let cleanedContent = content;
    const matches: Array<{ fullMatch: string; toolName: string; args: string | Record<string, unknown> }> = [];

    // Try each pattern
    for (const pattern of this.patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (pattern === this.patterns[1]) {
          // Format 2: Parse key-value pairs from "for key value key2 value2" format
          const [fullMatch, toolName, argsStr] = match;
          const args = this.parseKeyValuePairs(argsStr);
          matches.push({ fullMatch, toolName, args });
        } else {
          // Format 1 and 3: JSON arguments
          const [fullMatch, toolName, jsonArgs] = match;
          matches.push({ fullMatch, toolName, args: jsonArgs });
        }
      }
      // Reset the regex state for next use
      pattern.lastIndex = 0;
    }

    // Process each match
    for (const { fullMatch, toolName, args } of matches) {
      try {
        let parsedArgs: Record<string, unknown>;
        
        if (typeof args === 'string') {
          // Handle JSON string arguments
          parsedArgs = JSON.parse(args);
        } else {
          // Already parsed (from key-value format)
          parsedArgs = args;
        }
        
        toolCalls.push({
          name: toolName,
          arguments: parsedArgs
        });
        
        // Remove the tool call pattern from the content
        cleanedContent = cleanedContent.replace(fullMatch, '');
      } catch (error) {
        if (typeof args === 'string') {
          // Try to extract a simpler JSON pattern if the full match fails
          const simpleJsonMatch = args.match(/^{[^{]*}$/);
          if (simpleJsonMatch) {
            try {
              const parsedArgs = JSON.parse(simpleJsonMatch[0]);
              toolCalls.push({
                name: toolName,  
                arguments: parsedArgs
              });
              cleanedContent = cleanedContent.replace(fullMatch, '');
            } catch (_secondError) {
              console.error(`[GemmaToolCallParser] Failed to parse tool arguments for ${toolName}:`, error);
              console.error(`[GemmaToolCallParser] Raw arguments: ${args}`);
              // Keep the original text if we can't parse it
            }
          } else {
            console.error(`[GemmaToolCallParser] Failed to parse tool arguments for ${toolName}:`, error);
            console.error(`[GemmaToolCallParser] Raw arguments: ${args}`);
          }
        }
      }
    }

    // Clean up any extra whitespace
    cleanedContent = cleanedContent.replace(/\s+/g, ' ').trim();

    return {
      cleanedContent,
      toolCalls
    };
  }

  private parseKeyValuePairs(str: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    
    // Parse "key value key2 value2" format
    // Example: "path /Users/acoliver/projects/gemini-code/gemini-cli/docs"
    const parts = str.trim().split(/\s+/);
    
    for (let i = 0; i < parts.length; i += 2) {
      if (i + 1 < parts.length) {
        const key = parts[i];
        let value: string | number | boolean = parts[i + 1];
        
        // Handle quoted strings that might contain spaces
        if (value.startsWith('"') || value.startsWith("'")) {
          const quote = value[0];
          let endIndex = i + 1;
          
          // Find the closing quote
          while (endIndex < parts.length && !parts[endIndex].endsWith(quote)) {
            endIndex++;
          }
          
          if (endIndex < parts.length) {
            value = parts.slice(i + 1, endIndex + 1).join(' ');
            value = value.slice(1, -1); // Remove quotes
            i = endIndex - 1; // Adjust loop counter
          }
        }
        
        // Try to parse as number or boolean
        if (!isNaN(Number(value))) {
          args[key] = Number(value);
        } else if (value === 'true' || value === 'false') {
          args[key] = value === 'true';
        } else {
          args[key] = value;
        }
      }
    }
    
    return args;
  }
}