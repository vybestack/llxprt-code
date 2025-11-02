# SubagentCommand Integration Pseudocode

**Plan ID**: PLAN-20250117-SUBAGENTCONFIG.P02
**Component**: Integration
**Requirements**: REQ-013, REQ-015
**Pattern Reference**: ProfileCommand Integration

This document outlines how the SubagentCommand integrates with the core CLI architecture and its dependencies.

---

## 1. Service Injection and Dependency Management

1.  // File: packages/cli/src/ui/hooks/slashCommandProcessor.ts
2.  // Lines: ~100-150
3.  // @requirement:REQ-013, REQ-015
4.  
5.  // Import SubagentManager
6.  IMPORT { SubagentManager } from '@llxprt/core'
7.  
8.  // Initialize ProfileManager (dependency for SubagentManager) - Pattern from Phase 01
9.  profileManager = NEW ProfileManager()
10. 
11. // Initialize SubagentManager with its required dependencies
12. // This requires adding a new configuration entry for the subagent base directory.
13. TRY
14.   subagentBaseDir = context.config.get('subagents.baseDir') OR path.join(os.homedir(), '.llxprt', 'subagents')
15.   subagentManager = NEW SubagentManager(subagentBaseDir, profileManager)
16. CATCH errorOnInit
17.   console.error("Failed to initialize SubagentManager. Feature will be unavailable.")
18.   subagentManager = null
19. END TRY
20. 
21. // Inject the SubagentManager instance into the services object for use by the command.
22. // Other commands like profileCommand rely on their services being present here.
23. context.services.subagentManager = subagentManager

This injection makes the `SubagentManager` available to the `SubagentCommand` implementation via `context.services.subagentManager`. It also defines how the base directory for subagent files will be sourced from the configuration.

---

## 2. Command Registration

24. // File: packages/cli/src/ui/commands/index.ts
25. // Lines: ~1-50
26. // @requirement:REQ-015
27. 
28. // Import the new command handler
29. IMPORT { SubagentCommand } from './subagentCommand'
30.
31. // Register the command handler with the slash-command-menu plugin.
32. commandRegistry.register({
33.   name: 'subagent',
34.   description: 'Manage and use subagents for specialized tasks',
35.   handler: NEW SubagentCommand()
36. })

This registration makes `/subagent` a top-level available slash command.

---

## 3. Interface Definitions

37. // File: packages/core/src/interfaces/ISubagentConfig.ts
38. // Lines: 1-20
39. // @requirement:REQ-013
40. INTERFACE ISubagentConfig
41.   name: string
42.   profile: string // The execution profile (model, parameters) to use
43.   systemPrompt: string
44.   createdAt: string // ISOString
45.   updatedAt: string // ISOString
46. END INTERFACE

This interface represents the data contract for a saved subagent.

47.
48. // File: packages/core/src/interfaces/index.ts
49. // Lines: 1-30
50. // @requirement:REQ-013
51.
52. // Export the new interface to make it available
53. EXPORT TYPE { ISubagentConfig } from './ISubagentConfig'

This ensures that other parts of the core package can reference the type.

---

## 4. Core Package Exports

54. // File: packages/core/src/index.ts
55. // Lines: 1-100
56. // @requirement:REQ-013
57.
58. // Import SubagentManager implementation
59. IMPORT { SubagentManager } from './config/SubagentManager'
60.
61. // Re-export SubagentManager for external availability
62. EXPORT { SubagentManager }

This makes `SubagentManager` available as a public API from the `@llxprt/core` package, allowing `slashCommandProcessor.ts` to import and instantiate it.