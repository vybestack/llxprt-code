# Pseudocode: Core Events — McpClientUpdate (events.ts)

## Interface Contracts

```typescript
// INPUT: MCP client manager state change
// OUTPUT: Typed event with payload

// NEW type to add:
import type { McpClient } from '../tools/mcp-client.js';

export interface McpClientUpdatePayload {
  readonly clients: ReadonlyMap<string, McpClient>;
}

// NEW enum member:
export enum CoreEvent {
  // ... existing members ...
  McpClientUpdate = 'mcp-client-update',
  // ... existing members ...
}

// UPDATED interface — add McpClientUpdate entry:
export interface CoreEvents extends ExtensionEvents {
  // ... existing entries ...
  [CoreEvent.McpClientUpdate]: [McpClientUpdatePayload];
}

// UPDATED class — add typed overloads:
export class CoreEventEmitter extends EventEmitter {
  // on overload:
  override on(event: CoreEvent.McpClientUpdate, listener: (payload: McpClientUpdatePayload) => void): this;
  // off overload:
  override off(event: CoreEvent.McpClientUpdate, listener: (payload: McpClientUpdatePayload) => void): this;
  // emit overload:
  override emit(event: CoreEvent.McpClientUpdate, payload: McpClientUpdatePayload): boolean;
}
```

## Pseudocode

```
01: // === ADD McpClientUpdate to CoreEvent enum ===
02: IN CoreEvent enum:
03:   ADD McpClientUpdate = 'mcp-client-update'
04:   // Place BEFORE SettingsChanged to maintain alphabetical grouping of new additions
05:
06: // === ADD McpClientUpdatePayload interface ===
07: IMPORT McpClient from '../tools/mcp-client.js'
08: DEFINE INTERFACE McpClientUpdatePayload:
09:   clients: ReadonlyMap<string, McpClient>   // immutable view of manager's client map
10:
11: // === ADD to CoreEvents interface ===
12: IN CoreEvents interface:
13:   ADD [CoreEvent.McpClientUpdate]: [McpClientUpdatePayload]
14:
15: // === ADD on() overload to CoreEventEmitter ===
16: IN CoreEventEmitter class on() overloads:
17:   ADD: on(event: CoreEvent.McpClientUpdate, listener: (payload: McpClientUpdatePayload) => void): this
18:
19: // === ADD off() overload to CoreEventEmitter ===
20: IN CoreEventEmitter class off() overloads:
21:   ADD: off(event: CoreEvent.McpClientUpdate, listener: (payload: McpClientUpdatePayload) => void): this
22:
23: // === ADD emit() overload to CoreEventEmitter ===
24: // NOTE: CoreEventEmitter does not currently have custom emit() overloads
25: // Check if emit needs typed overloads or if the interface union is sufficient
26: // If emit overloads exist for other events, add one for McpClientUpdate
27: // If no emit overloads exist, rely on the CoreEvents interface for type safety
28:
29: // === VERIFY re-export ===
30: IN packages/core/src/index.ts:
31:   VERIFY wildcard re-export covers new enum member and interface
32:   // export * from './utils/events.js' — should already cover it
```

## Integration Points

```
Line 03: Enum value 'mcp-client-update' becomes the single source of truth
         - After this change, ALL emits and listens MUST use CoreEvent.McpClientUpdate
         - The raw string 'mcp-client-update' must not appear anywhere else

Line 09: ReadonlyMap prevents listeners from mutating the manager's internal map
         - Emit sites must wrap: { clients: this.clients } where this.clients is Map<string, McpClient>
         - TypeScript will allow Map → ReadonlyMap (covariant)

Line 13: CoreEvents interface entry enables typed emit/on/off
         - The [McpClientUpdatePayload] tuple matches the single-argument emit pattern

Lines 16-21: Overloads enable TypeScript to enforce correct handler signatures
         - coreEvents.on(CoreEvent.McpClientUpdate, (payload: McpClientUpdatePayload) => {...})
         - Wrong payload type → compile error
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Use Array<Map<string, McpClient> | never> as payload type (upstream form)
[OK] DO: Use McpClientUpdatePayload { clients: ReadonlyMap<string, McpClient> }

[ERROR] DO NOT: Add a second 'mcp-client-update' string anywhere (tests, emitters, listeners)
[OK] DO: Always reference CoreEvent.McpClientUpdate enum constant

[ERROR] DO NOT: Make payload.clients a mutable Map
[OK] DO: Use ReadonlyMap to prevent listener-side mutation

[ERROR] DO NOT: Add emit overloads if the existing pattern relies only on the interface
[OK] DO: Match the existing overload pattern in CoreEventEmitter (on/off have overloads)
```
