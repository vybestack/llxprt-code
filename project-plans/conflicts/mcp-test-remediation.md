# MCP Client Test Merge Conflict Resolution

## File: `packages/core/src/tools/mcp-client.test.ts`

### Conflict Location

Lines 388-402

### Conflict Description

The merge conflict occurred between the `HEAD` branch and the `multi-provider` branch. The conflict involved a test case for OAuth token support in MCP HTTP connections.

### Resolution Strategy

Kept the OAuth token test from the `HEAD` branch, as it represents newer functionality that should be preserved.

### Changes Made

1. Removed conflict markers (`<<<<<<< HEAD`, `=======`, `>>>>>>> multi-provider`)
2. Preserved the OAuth token test case that was added in HEAD:

   ```typescript
   it('should pass oauth token when provided', async () => {
     const headers = {
       Authorization: 'Bearer test-token',
     };
     const { serverConfig } = await setupHttpTest(headers);

     expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
       new URL(serverConfig.httpUrl!),
       { requestInit: { headers } },
     );
   });
   ```

3. Maintained proper test structure with correct closing braces

### Verification

- The file now contains valid TypeScript syntax
- All conflict markers have been removed
- The test structure is intact with proper nesting
- Both the backwards compatibility test and the OAuth token test are preserved
