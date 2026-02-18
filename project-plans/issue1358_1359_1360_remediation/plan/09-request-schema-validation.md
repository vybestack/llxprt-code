# Plan 09: Request Schema Validation (R7.1)

**Spec Reference**: requirements.md R7.1-R7.3  
**File**: `packages/cli/src/auth/proxy/credential-proxy-server.ts`  
**Prerequisite**: None (can be implemented independently)

---

## Overview

Each operation must have a defined request schema with required fields and types. The server validates incoming requests against these schemas BEFORE processing, returning `INVALID_REQUEST` for malformed requests without touching any credential stores.

---

## Requirements Trace

| Requirement | Source | Description |
|-------------|--------|-------------|
| R7.1 | Spec | Each operation has a defined schema validated server-side before processing |
| R7.2 | Spec | Malformed requests return `INVALID_REQUEST` without touching credential stores |
| R7.3 | Spec | Operation/flow-type mismatch returns `INVALID_REQUEST` with specific message |

---

## Current State

The current implementation has ad-hoc validation scattered across handlers:

```typescript
// Example from handleGetToken
private async handleGetToken(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const provider = payload.provider as string | undefined;
  const bucket = payload.bucket as string | undefined;
  if (!provider) {
    this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
    return;
  }
  // ... no type validation, just cast
}
```

Problems:
1. No type validation (assumes values are correct types)
2. Inconsistent validation patterns across handlers
3. No centralized schema definitions
4. Easy to forget validation for new fields

---

## Target State

### Schema Definitions with Zod

```typescript
import { z } from 'zod';

// Common field schemas
const providerSchema = z.string().min(1).max(100);
const bucketSchema = z.string().min(1).max(100).optional();
const sessionIdSchema = z.string().regex(/^[a-f0-9]{32}$/);

// Per-operation request schemas
const requestSchemas = {
  // Token operations
  get_token: z.object({
    provider: providerSchema,
    bucket: bucketSchema,
  }),
  
  save_token: z.object({
    provider: providerSchema,
    token: z.object({
      access_token: z.string().min(1),
      token_type: z.string().min(1),
      expiry: z.number().int().positive().optional(),
      scope: z.string().optional(),
      refresh_token: z.string().optional(), // Will be stripped by handler
      // Provider-specific fields
      account_id: z.string().optional(),
      id_token: z.string().optional(),
      resource_url: z.string().optional(),
    }),
    bucket: bucketSchema,
  }),
  
  remove_token: z.object({
    provider: providerSchema,
    bucket: bucketSchema,
  }),
  
  list_providers: z.object({}).strict(), // No payload expected
  
  list_buckets: z.object({
    provider: providerSchema,
  }),
  
  get_bucket_stats: z.object({
    provider: providerSchema,
    bucket: z.string().min(1), // Required for stats
  }),
  
  // API key operations
  get_api_key: z.object({
    name: z.string().min(1).max(100),
  }),
  
  list_api_keys: z.object({}).strict(),
  
  has_api_key: z.object({
    name: z.string().min(1).max(100),
  }),
  
  // OAuth operations
  oauth_initiate: z.object({
    provider: providerSchema,
    bucket: bucketSchema,
  }),
  
  oauth_exchange: z.object({
    session_id: sessionIdSchema,
    code: z.string().min(1).max(10000), // Auth codes can be long
  }),
  
  oauth_poll: z.object({
    session_id: sessionIdSchema,
  }),
  
  oauth_cancel: z.object({
    session_id: sessionIdSchema,
  }),
  
  // Refresh operation
  refresh_token: z.object({
    provider: providerSchema,
    bucket: bucketSchema,
  }),
} as const;

type OperationType = keyof typeof requestSchemas;
```

### Validation Layer

```typescript
/**
 * Validates a request payload against its operation schema.
 * Returns validated payload or throws validation error.
 */
function validateRequest<T extends OperationType>(
  op: T,
  payload: unknown,
): z.infer<typeof requestSchemas[T]> {
  const schema = requestSchemas[op];
  if (!schema) {
    throw new ValidationError(`Unknown operation: ${op}`);
  }
  
  try {
    return schema.parse(payload);
  } catch (err) {
    if (err instanceof z.ZodError) {
      // Format Zod errors into user-friendly message
      const issues = err.issues.map(issue => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      throw new ValidationError(`Invalid request: ${issues.join('; ')}`);
    }
    throw err;
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

### Integration into dispatchRequest

```typescript
private async dispatchRequest(
  socket: net.Socket,
  frame: Record<string, unknown>,
): Promise<void> {
  const id = frame.id as string;
  const op = frame.op as string;
  const rawPayload = frame.payload ?? {};
  
  // Rate limiting check (from Plan 07)
  // ...
  
  // Validate request schema BEFORE any processing
  let payload: unknown;
  try {
    if (!(op in requestSchemas)) {
      this.sendError(socket, id, 'INVALID_REQUEST', `Unknown operation: ${op}`);
      return;
    }
    payload = validateRequest(op as OperationType, rawPayload);
  } catch (err) {
    if (err instanceof ValidationError) {
      this.sendError(socket, id, 'INVALID_REQUEST', err.message);
      return;
    }
    throw err;
  }
  
  // Dispatch to handler with validated payload
  switch (op) {
    case 'get_token':
      await this.handleGetToken(socket, id, payload as z.infer<typeof requestSchemas.get_token>);
      break;
    case 'save_token':
      await this.handleSaveToken(socket, id, payload as z.infer<typeof requestSchemas.save_token>);
      break;
    // ... other cases
  }
}

// Updated handler signature - payload is now typed and validated
private async handleGetToken(
  socket: net.Socket,
  id: string,
  payload: { provider: string; bucket?: string },
): Promise<void> {
  // No need for manual validation - already done
  const { provider, bucket } = payload;
  // ... proceed with operation
}
```

### Flow-Type Mismatch Validation (R7.3)

```typescript
/**
 * Validates that the operation matches the session's flow type.
 * Per R7.3: oauth_exchange requires pkce_redirect, oauth_poll requires device_code/browser_redirect
 */
private validateOperationFlowMatch(
  op: 'oauth_exchange' | 'oauth_poll',
  session: OAuthSession,
): void {
  const validFlows: Record<string, Set<OAuthSession['flowType']>> = {
    oauth_exchange: new Set(['pkce_redirect']),
    oauth_poll: new Set(['device_code', 'browser_redirect']),
  };
  
  const allowed = validFlows[op];
  if (!allowed?.has(session.flowType)) {
    throw new ValidationError(
      `Operation '${op}' is not valid for flow type '${session.flowType}'. ` +
      `Expected one of: ${Array.from(allowed ?? []).join(', ')}`
    );
  }
}

// Usage in handlers:
private async handleOAuthExchange(
  socket: net.Socket,
  id: string,
  payload: { session_id: string; code: string },
): Promise<void> {
  const session = this.oauthSessions.get(payload.session_id);
  if (!session) {
    this.sendError(socket, id, 'SESSION_NOT_FOUND', 'OAuth session not found');
    return;
  }
  
  try {
    this.validateOperationFlowMatch('oauth_exchange', session);
  } catch (err) {
    if (err instanceof ValidationError) {
      this.sendError(socket, id, 'INVALID_REQUEST', err.message);
      return;
    }
    throw err;
  }
  
  // ... proceed with exchange
}
```

---

## Behavioral Test Scenarios

### Scenario 1: Valid request passes validation (NON-FAKEABLE)

```gherkin
@given a properly formed get_token request
@when the request is validated
@then the request is processed successfully
```

**Non-Fakeable Test** (schema must correctly accept valid inputs):
```typescript
describe('Request validation - valid requests', () => {
  it('accepts valid get_token request', async () => {
    // This test is non-fakeable because:
    // 1. The schema must be correctly defined
    // 2. A stub that accepts everything would fail invalid tests
    
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
    });
    const socketPath = await server.start();
    const client = await connectClient(socketPath);
    
    // Valid request
    const response = await client.request('get_token', {
      provider: 'anthropic',
      bucket: 'my-bucket',
    });
    
    // Should not fail with INVALID_REQUEST
    expect(response.code).not.toBe('INVALID_REQUEST');
    
    client.close();
    await server.stop();
  });
  
  it('accepts valid oauth_initiate request', async () => {
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
    });
    const socketPath = await server.start();
    const client = await connectClient(socketPath);
    
    const response = await client.request('oauth_initiate', {
      provider: 'anthropic',
    });
    
    // May fail for other reasons but NOT validation
    expect(response.code).not.toBe('INVALID_REQUEST');
    
    client.close();
    await server.stop();
  });
});
```

### Scenario 2: Missing required field returns INVALID_REQUEST (NON-FAKEABLE)

```gherkin
@given a get_token request missing the provider field
@when the request is validated
@then INVALID_REQUEST is returned
@and the error message mentions the missing field
```

**Non-Fakeable Test**:
```typescript
describe('Request validation - missing fields', () => {
  it('rejects get_token without provider', async () => {
    // This test is non-fakeable because:
    // 1. A stub without validation would process the request
    // 2. Only real validation catches the missing field
    
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
    });
    const socketPath = await server.start();
    const client = await connectClient(socketPath);
    
    const response = await client.request('get_token', {
      // Missing 'provider' field
      bucket: 'my-bucket',
    });
    
    expect(response.ok).toBe(false);
    expect(response.code).toBe('INVALID_REQUEST');
    expect(response.error).toMatch(/provider/i);
    
    client.close();
    await server.stop();
  });
  
  it('rejects save_token without token object', async () => {
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
    });
    const socketPath = await server.start();
    const client = await connectClient(socketPath);
    
    const response = await client.request('save_token', {
      provider: 'anthropic',
      // Missing 'token' field
    });
    
    expect(response.ok).toBe(false);
    expect(response.code).toBe('INVALID_REQUEST');
    expect(response.error).toMatch(/token/i);
    
    client.close();
    await server.stop();
  });
});
```

### Scenario 3: Wrong type returns INVALID_REQUEST (NON-FAKEABLE)

```gherkin
@given a request with provider as a number instead of string
@when the request is validated
@then INVALID_REQUEST is returned
@and the error message describes the type error
```

**Non-Fakeable Test**:
```typescript
describe('Request validation - wrong types', () => {
  it('rejects provider as number', async () => {
    // Non-fakeable: only real type validation catches this
    
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
    });
    const socketPath = await server.start();
    const client = await connectClient(socketPath);
    
    const response = await client.request('get_token', {
      provider: 12345, // Wrong type
      bucket: 'my-bucket',
    });
    
    expect(response.ok).toBe(false);
    expect(response.code).toBe('INVALID_REQUEST');
    expect(response.error).toMatch(/string/i);
    
    client.close();
    await server.stop();
  });
  
  it('rejects token.expiry as string', async () => {
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
    });
    const socketPath = await server.start();
    const client = await connectClient(socketPath);
    
    const response = await client.request('save_token', {
      provider: 'anthropic',
      token: {
        access_token: 'test',
        token_type: 'Bearer',
        expiry: 'not-a-number', // Wrong type
      },
    });
    
    expect(response.ok).toBe(false);
    expect(response.code).toBe('INVALID_REQUEST');
    
    client.close();
    await server.stop();
  });
});
```

### Scenario 4: Unknown operation returns INVALID_REQUEST

```gherkin
@given a request with an unknown operation type
@when the request is dispatched
@then INVALID_REQUEST is returned
@and the error mentions unknown operation
```

**Test Code**:
```typescript
describe('Request validation - unknown operation', () => {
  it('rejects unknown operation', async () => {
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
    });
    const socketPath = await server.start();
    const client = await connectClient(socketPath);
    
    const response = await client.request('delete_everything', {});
    
    expect(response.ok).toBe(false);
    expect(response.code).toBe('INVALID_REQUEST');
    expect(response.error).toMatch(/unknown operation/i);
    
    client.close();
    await server.stop();
  });
});
```

### Scenario 5: Flow-type mismatch returns INVALID_REQUEST (R7.3)

```gherkin
@given an OAuth session with flow_type='device_code'
@when oauth_exchange is called for that session
@then INVALID_REQUEST is returned
@and the error explains the mismatch
```

**Test Code**:
```typescript
describe('Request validation - flow type mismatch', () => {
  it('rejects oauth_exchange for device_code flow', async () => {
    // Setup: Create session with device_code flow
    const mockFlow = {
      initiateDeviceFlow: vi.fn().mockResolvedValue({
        device_code: 'device123',
        user_code: 'ABC-XYZ',
        verification_uri: 'https://example.com',
        interval: 5,
      }),
    };
    
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
      flowFactories: new Map([['qwen', () => mockFlow]]),
    });
    const socketPath = await server.start();
    const client = await connectClient(socketPath);
    
    // Initiate device_code flow
    const initResponse = await client.request('oauth_initiate', {
      provider: 'qwen',
    });
    expect(initResponse.data.flow_type).toBe('device_code');
    const sessionId = initResponse.data.session_id;
    
    // Try exchange (should fail - exchange is for pkce_redirect)
    const exchangeResponse = await client.request('oauth_exchange', {
      session_id: sessionId,
      code: 'auth-code-123',
    });
    
    expect(exchangeResponse.ok).toBe(false);
    expect(exchangeResponse.code).toBe('INVALID_REQUEST');
    expect(exchangeResponse.error).toMatch(/not valid.*device_code/i);
    
    client.close();
    await server.stop();
  });
  
  it('rejects oauth_poll for pkce_redirect flow', async () => {
    const mockFlow = {
      initiateDeviceFlow: vi.fn().mockResolvedValue({
        device_code: 'pkce_verifier',
        verification_uri_complete: 'https://example.com/auth',
      }),
    };
    
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
      flowFactories: new Map([['anthropic', () => mockFlow]]),
    });
    const socketPath = await server.start();
    const client = await connectClient(socketPath);
    
    // Initiate pkce_redirect flow
    const initResponse = await client.request('oauth_initiate', {
      provider: 'anthropic',
    });
    expect(initResponse.data.flow_type).toBe('pkce_redirect');
    const sessionId = initResponse.data.session_id;
    
    // Try poll (should fail - poll is for device_code/browser_redirect)
    const pollResponse = await client.request('oauth_poll', {
      session_id: sessionId,
    });
    
    expect(pollResponse.ok).toBe(false);
    expect(pollResponse.code).toBe('INVALID_REQUEST');
    expect(pollResponse.error).toMatch(/not valid.*pkce_redirect/i);
    
    client.close();
    await server.stop();
  });
});
```

### Scenario 6: Validation doesn't touch credential store on failure

```gherkin
@given an invalid save_token request (missing access_token)
@when the request is validated
@then INVALID_REQUEST is returned
@and the token store was never called
```

**Test Code**:
```typescript
describe('Request validation - no side effects', () => {
  it('does not touch store on validation failure', async () => {
    const tokenStore = new InMemoryTokenStore();
    const saveTokenSpy = vi.spyOn(tokenStore, 'saveToken');
    
    const server = new CredentialProxyServer({
      tokenStore,
      providerKeyStorage: new InMemoryProviderKeyStorage(),
    });
    const socketPath = await server.start();
    const client = await connectClient(socketPath);
    
    // Invalid request - missing access_token
    const response = await client.request('save_token', {
      provider: 'anthropic',
      token: {
        // Missing access_token
        token_type: 'Bearer',
      },
    });
    
    expect(response.ok).toBe(false);
    expect(response.code).toBe('INVALID_REQUEST');
    
    // Token store should NOT have been called
    expect(saveTokenSpy).not.toHaveBeenCalled();
    
    client.close();
    await server.stop();
  });
});
```

### Scenario 7: Unit tests for validateRequest function

```typescript
describe('validateRequest', () => {
  it('returns validated payload for valid input', () => {
    const payload = { provider: 'anthropic', bucket: 'test' };
    const result = validateRequest('get_token', payload);
    
    expect(result).toEqual(payload);
  });
  
  it('throws ValidationError for missing field', () => {
    expect(() => validateRequest('get_token', {}))
      .toThrow(ValidationError);
  });
  
  it('throws ValidationError for wrong type', () => {
    expect(() => validateRequest('get_token', { provider: 123 }))
      .toThrow(ValidationError);
  });
  
  it('throws ValidationError for unknown operation', () => {
    expect(() => validateRequest('unknown_op' as any, {}))
      .toThrow(ValidationError);
  });
  
  it('error message includes field path', () => {
    try {
      validateRequest('save_token', {
        provider: 'anthropic',
        token: { token_type: 'Bearer' }, // Missing access_token
      });
      fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as Error).message).toMatch(/access_token/);
    }
  });
  
  it('accepts optional bucket field', () => {
    const payload = { provider: 'anthropic' }; // No bucket
    const result = validateRequest('get_token', payload);
    
    expect(result.provider).toBe('anthropic');
    expect(result.bucket).toBeUndefined();
  });
  
  it('rejects extra fields in strict schemas', () => {
    expect(() => validateRequest('list_providers', { extra: 'field' }))
      .toThrow(ValidationError);
  });
});
```

---

## Implementation Steps

### Step 9.1: Add Zod dependency

Zod should already be in the project. If not:
```bash
npm install zod --workspace=@vybestack/llxprt-code-cli
```

### Step 9.2: Define request schemas

Create `packages/cli/src/auth/proxy/request-schemas.ts`:
```typescript
import { z } from 'zod';

// Export all schemas and types
export const requestSchemas = { /* ... */ };
export type OperationType = keyof typeof requestSchemas;
export type RequestPayload<T extends OperationType> = z.infer<typeof requestSchemas[T]>;
```

### Step 9.3: Implement validateRequest function

In same file or `credential-proxy-server.ts`:
```typescript
export function validateRequest<T extends OperationType>(
  op: T,
  payload: unknown,
): RequestPayload<T> { /* ... */ }

export class ValidationError extends Error { /* ... */ }
```

### Step 9.4: Update dispatchRequest

Add validation call before switch statement.

### Step 9.5: Update handler signatures

Change handlers to use typed payloads:
```typescript
// Before
handleGetToken(socket, id, payload: Record<string, unknown>)

// After
handleGetToken(socket, id, payload: { provider: string; bucket?: string })
```

### Step 9.6: Add flow-type mismatch validation

Implement `validateOperationFlowMatch()` and call in `handleOAuthExchange` and `handleOAuthPoll`.

---

## Verification Criteria

| Criterion | Verification Method |
|-----------|---------------------|
| Valid requests pass | Integration test |
| Missing fields rejected | Integration test per operation |
| Wrong types rejected | Integration test |
| Unknown ops rejected | Integration test |
| Flow mismatch rejected | Integration test |
| Store not touched on failure | Unit test with spy |
| Error messages are helpful | Manual review + unit test |

---

## Security Considerations

1. **Input Sanitization**: Zod validates types and formats, preventing injection attacks.

2. **Error Messages**: Don't leak sensitive info in validation errors. Field names and type expectations are safe.

3. **Schema Strictness**: Use `.strict()` for operations that shouldn't have extra fields to prevent field injection.

4. **Size Limits**: Add `.max()` constraints to prevent memory exhaustion from huge inputs.
