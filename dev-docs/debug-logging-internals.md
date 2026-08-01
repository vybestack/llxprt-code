# Debug Logging Internals

Implementation record for the `DebugLogger` programmatic API. For the
user-facing guide, see [docs/debug-logging.md](../docs/debug-logging.md).

## Status and authority

Authoritative for the programmatic debug-logging interface. This page covers
material that was removed from `docs/debug-logging.md` because it exposes
internal APIs that CLI users do not call directly.

## Context

The debug system has two layers: a user-facing configuration and command
surface (`--debug` flag, `/debug` commands, `DEBUG` / `LLXPRT_DEBUG`
environment variables), and a programmatic `DebugLogger` class used throughout
the codebase. This page documents the programmatic layer.

## Source and test locations

- Class: `packages/telemetry/src/debug/DebugLogger.ts`
- Singleton re-export: `packages/telemetry/src/utils/debugLogger.ts`
- Package index: `packages/telemetry/src/debug/index.ts`
- Tests: `packages/telemetry/src/debug/DebugLogger.test.ts`,
  `packages/telemetry/src/debug/DebugLogger.lifecycle.test.ts`

The `DebugLogger` class is re-exported from `@vybestack/llxprt-code-core` and
`@vybestack/llxprt-code-telemetry`.

## API usage

```typescript
import { DebugLogger } from '@vybestack/llxprt-code-core';

// Create a logger with a specific namespace
const logger = new DebugLogger('llxprt:mycomponent:feature');

// Basic logging
logger.log('Simple message');
logger.debug('Debug message');
logger.error('Error message');

// Lazy evaluation for expensive operations
logger.debug(() => `Result: ${JSON.stringify(largeObject)}`);

// With additional arguments
logger.log('Processing request', requestId, userId);
```

### Factory method

`DebugLogger.getLogger(namespace)` returns a cached singleton per namespace.
Instances are retained until explicitly disposed (`disposeAll()`,
`dispose()`).

### Lazy evaluation

When debugging is disabled for a namespace, methods that receive a function
argument (e.g., `logger.debug(() => ...)`) never call the function, so there is
zero overhead.
