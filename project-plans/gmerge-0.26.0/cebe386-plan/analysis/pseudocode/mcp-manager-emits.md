# Pseudocode: MCP Manager Emit Migration (mcp-client-manager.ts)

## Interface Contracts

```typescript
// DEPENDENCY: coreEvents singleton (already imported for emitFeedback)
import { coreEvents, CoreEvent } from '../utils/events.js';

// DEPENDENCY: McpClientUpdatePayload
import type { McpClientUpdatePayload } from '../utils/events.js';

// CURRENT emit pattern (to be replaced):
this.eventEmitter?.emit('mcp-client-update', this.clients);

// TARGET emit pattern:
coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients });

// NEW method to add:
getMcpServerCount(): number {
  return this.clients.size;
}
```

## Pseudocode

```
01: // === IMPORT coreEvents and CoreEvent ===
02: // coreEvents is likely already imported for emitFeedback usage
03: VERIFY import of coreEvents from '../utils/events.js'
04: ADD import of CoreEvent from '../utils/events.js' (if not present)
05: ADD import of McpClientUpdatePayload type from '../utils/events.js'
06:
07: // === MIGRATE emit site 1: maybeDiscoverMcpServer success (line ~116) ===
08: REPLACE: this.eventEmitter?.emit('mcp-client-update', this.clients)
09: WITH:    coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })
10:
11: // === MIGRATE emit site 2: client add/update (line ~191) ===
12: REPLACE: this.eventEmitter?.emit('mcp-client-update', this.clients)
13: WITH:    coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })
14:
15: // === MIGRATE emit site 3: client error (line ~196) ===
16: REPLACE: this.eventEmitter?.emit('mcp-client-update', this.clients)
17: WITH:    coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })
18:
19: // === MIGRATE emit site 4: client status change (line ~198) ===
20: REPLACE: this.eventEmitter?.emit('mcp-client-update', this.clients)
21: WITH:    coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })
22:
23: // === MIGRATE emit site 5: removeMcpServer (line ~233) ===
24: REPLACE: this.eventEmitter?.emit('mcp-client-update', this.clients)
25: WITH:    coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })
26:
27: // === MIGRATE emit site 6: restartMcpServer (line ~268) ===
28: REPLACE: this.eventEmitter?.emit('mcp-client-update', this.clients)
29: WITH:    coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })
30:
31: // === ADD emit on IN_PROGRESS transition (line ~230) ===
32: AFTER: this.discoveryState = MCPDiscoveryState.IN_PROGRESS
33: ADD:   coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })
34:
35: // === ADD emit on COMPLETED transition (line ~240) — CRITICAL ===
36: // This is the most important change. Currently COMPLETED is set without emit.
37: AFTER: this.discoveryState = MCPDiscoveryState.COMPLETED
38: ADD:   coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })
39: // Without this, useMcpStatus never learns discovery is done → deadlock
40:
41: // === ADD emit on zero-server fast path ===
42: // When startConfiguredMcpServers is called with empty config:
43: IF Object.keys(servers).length === 0:
44:   SET this.discoveryState = MCPDiscoveryState.COMPLETED
45:   EMIT coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })
46:   RETURN
47:
48: // === ADD getMcpServerCount method ===
49: METHOD getMcpServerCount(): number
50:   RETURN this.clients.size
51:
52: // === AUDIT eventEmitter usage ===
53: // After migration, this.eventEmitter should NOT be used for 'mcp-client-update'
54: // It may still be needed for other event types (extension events pass through Config)
55: // DO NOT remove the eventEmitter parameter entirely — verify non-MCP usages first
```

## Integration Points

```
Lines 07-29: Each emit site must change from raw string to enum constant
         - The injected this.eventEmitter is bypassed for MCP events
         - coreEvents is the direct target (same singleton useMcpStatus listens on)

Lines 31-33: IN_PROGRESS emit enables UI to show "discovering" state
         - Optional but recommended for responsive UI feedback

Lines 35-38: CRITICAL — COMPLETED emit is the unlock signal for the message queue
         - Without this, useMcpStatus stays at IN_PROGRESS forever
         - The queue never flushes → user prompts are trapped

Lines 41-46: Zero-server fast path prevents app from hanging when no MCP configured
         - Must emit before returning, so useMcpStatus initializes correctly
         - If hook mounts after this path runs, useState initializer catches it

Lines 48-50: getMcpServerCount provides server count without exposing internal map
         - Used by useMcpStatus to determine isMcpReady in NOT_STARTED state
         - Returns 0 when no servers configured → triggers ready fast path
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Leave any this.eventEmitter?.emit('mcp-client-update', ...) calls
[OK] DO: Replace ALL 6 existing sites + add 2-3 new emit sites

[ERROR] DO NOT: Use raw string 'mcp-client-update' in emit calls
[OK] DO: Use CoreEvent.McpClientUpdate enum constant everywhere

[ERROR] DO NOT: Pass raw Map as emit argument
[OK] DO: Wrap in payload object: { clients: this.clients }

[ERROR] DO NOT: Remove eventEmitter parameter from constructor (still needed for extensions)
[OK] DO: Keep parameter, just stop using it for MCP events

[ERROR] DO NOT: Forget the COMPLETED transition emit (line ~240)
[OK] DO: Emit immediately after setting discoveryState = COMPLETED

[ERROR] DO NOT: Forget the zero-server fast path emit
[OK] DO: Transition to COMPLETED and emit when no servers configured
```
