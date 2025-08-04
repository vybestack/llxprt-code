# Template Engine Pseudocode

## Overview

The Template Engine performs simple variable substitution in prompt files using the {{variable}} syntax.

## Functions

### FUNCTION: processTemplate

INPUTS:

- content: string (template content with {{variables}})
- variables: map of string->string (variable name to value mapping)
  OUTPUT: string (processed content with variables substituted)

ALGORITHM:

1. Validate inputs
   a. IF content is null or undefined:
   - RETURN empty string
     b. IF content is not a string:
   - RETURN content unchanged (type coercion safety)
     c. IF variables is null or undefined:
   - Set variables to empty map

2. Initialize processing state
   a. Set result to empty string
   b. Set currentPosition to 0
   c. Set contentLength to length of content

3. WHILE currentPosition < contentLength:
   a. Find position of next "{{" starting from currentPosition
   b. IF no "{{" found:
   - Append substring from currentPosition to end to result
   - BREAK from loop

   c. Append substring from currentPosition to "{{" position to result
   d. Set openBracketPos to position of "{{"
   e. Find position of next "}}" starting from openBracketPos + 2

   f. IF no "}}" found:
   - Append substring from openBracketPos to end to result
   - BREAK from loop

   g. Extract variable name:
   - Set variableName to substring between "{{" and "}}"
   - Trim leading and trailing whitespace from variableName

   h. Perform substitution:
   - IF variableName exists in variables map:
     - Get variableValue from variables map
     - IF variableValue is null or undefined:
       - Append empty string to result
     - ELSE:
       - Append variableValue to result
   - ELSE:
     - Append empty string to result

   i. Update currentPosition to position after "}}"

4. RETURN result

ERROR HANDLING:

- Invalid input types: Return content unchanged
- Null/undefined content: Return empty string
- Null/undefined variables: Treat as empty map
- Missing variable in map: Substitute with empty string
- Unclosed brackets: Leave as-is in output

### FUNCTION: extractVariables

INPUTS:

- content: string (template content to analyze)
  OUTPUT: array of string (unique variable names found)

ALGORITHM:

1. Validate input
   a. IF content is null or undefined or not string:
   - RETURN empty array

2. Initialize collection
   a. Create empty set for uniqueVariables
   b. Set currentPosition to 0
   c. Set contentLength to length of content

3. WHILE currentPosition < contentLength:
   a. Find position of next "{{" starting from currentPosition
   b. IF no "{{" found:
   - BREAK from loop

   c. Set openBracketPos to position of "{{"
   d. Find position of next "}}" starting from openBracketPos + 2
   e. IF no "}}" found:
   - BREAK from loop

   f. Extract variable name:
   - Set variableName to substring between "{{" and "}}"
   - Trim leading and trailing whitespace from variableName

   g. IF variableName is not empty:
   - Add variableName to uniqueVariables set

   h. Update currentPosition to position after "}}"

4. Convert set to array and RETURN

ERROR HANDLING:

- Invalid input: Return empty array
- Malformed templates: Skip invalid variables

### FUNCTION: validateTemplate

INPUTS:

- content: string (template to validate)
  OUTPUT: object with properties:
- isValid: boolean
- errors: array of error messages

ALGORITHM:

1. Initialize validation result
   a. Set isValid to true
   b. Create empty array for errors

2. Check for unclosed opening brackets
   a. Set openCount to 0
   b. Set closeCount = 0
   c. Set position to 0
   d. WHILE position < content length:
   - Find next "{{" from position
   - IF found:
     - Increment openCount
     - Update position
   - ELSE: - BREAK
     e. Reset position to 0
     f. WHILE position < content length:
   - Find next "}}" from position
   - IF found:
     - Increment closeCount
     - Update position
   - ELSE: - BREAK
     g. IF openCount != closeCount:
   - Set isValid to false
   - Add error "Mismatched brackets: {openCount} opening, {closeCount} closing"

3. Check for nested variables (not supported)
   a. Extract all variables using extractVariables function
   b. FOR each variable in variables:
   - IF variable contains "{{" or "}}":
     - Set isValid to false
     - Add error "Nested variables not supported: {variable}"

4. Check for empty variable names
   a. Set position to 0
   b. WHILE position < content length:
   - Find next "{{" from position
   - IF not found: BREAK
   - Find matching "}}"
   - IF found:
     - Extract variable name and trim
     - IF variable name is empty:
       - Set isValid to false
       - Add error "Empty variable name at position {position}"
   - Update position

5. RETURN object with isValid and errors

ERROR HANDLING:

- Null/undefined input: Return {isValid: false, errors: ["Invalid input"]}

### FUNCTION: createVariablesFromContext

INPUTS:

- context: object with provider, model, enabledTools, environment
- currentTool: string or null (tool being processed)
  OUTPUT: map of string->string (variable name to value)

ALGORITHM:

1. Validate context
   a. IF context is null or undefined:
   - RETURN empty map

2. Initialize variables map
   a. Create empty map for variables

3. Add basic context variables
   a. IF context.provider exists:
   - Set variables["PROVIDER"] = context.provider
     b. IF context.model exists:
   - Set variables["MODEL"] = context.model

4. Add tool-specific variable
   a. IF currentTool is not null and not empty:
   - Set variables["TOOL_NAME"] = currentTool

5. Add environment variables
   a. IF context.environment exists:
   - IF context.environment.isGitRepository is true:
     - Set variables["IS_GIT_REPO"] = "true"
   - IF context.environment.isSandboxed is true:
     - Set variables["IS_SANDBOXED"] = "true"
   - IF context.environment.hasIdeCompanion is true:
     - Set variables["HAS_IDE"] = "true"

6. Add derived variables
   a. Set variables["PROVIDER_UPPER"] = uppercase(context.provider)
   b. Set variables["MODEL_SAFE"] = replace non-alphanumeric in context.model with underscore

7. RETURN variables map

ERROR HANDLING:

- Missing context properties: Skip those variables
- Invalid types: Use string conversion or skip

## Edge Cases

### Edge Case 1: Consecutive Variables

INPUT: "Hello {{name}}{{punctuation}}"
VARIABLES: {name: "World", punctuation: "!"}
OUTPUT: "Hello World!"

### Edge Case 2: Variable with Spaces

INPUT: "Value: {{ spaced var }}"
HANDLING: Trim spaces, look for "spaced var" in map

### Edge Case 3: Escaped Brackets

INPUT: "Show \{{example\}}"
HANDLING: Not supported - will try to find variable named "example\"

### Edge Case 4: Unicode in Variables

INPUT: "Hello {{名前}}"
VARIABLES: {名前: "World"}
OUTPUT: "Hello World"

### Edge Case 5: Very Long Variable Names

INPUT: "{{this_is_a_very_long_variable_name_that_might_cause_issues}}"
HANDLING: No length limit, process normally

### Edge Case 6: Special Characters in Variable Names

INPUT: "{{var-with-dashes}} and {{var.with.dots}}"
HANDLING: Process as-is, look up exact string in map

## Performance Considerations

1. Single-pass processing where possible
2. Avoid regex for better performance
3. Use string builder pattern for result construction
4. Cache position calculations to avoid redundant searches
5. Early termination when no more variables found
