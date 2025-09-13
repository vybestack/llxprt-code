# Pseudocode: ProviderManager token accumulation

10: CLASS ProviderManager
11:   PROPERTY providers: Map<string, IProvider>
12:   PROPERTY sessionTokenUsage: object - NEW FIELD for tracking session token usage
13:     PROPERTY input: number = 0
14:     PROPERTY output: number = 0
15:     PROPERTY cache: number = 0
16:     PROPERTY tool: number = 0
17:     PROPERTY thought: number = 0
18:     PROPERTY total: number = 0
19:   END PROPERTY
20: 
21:   METHOD accumulateSessionTokens(providerName: string, usage: {input: number, output: number, cache: number, tool: number, thought: number})
22:     INCREMENT this.sessionTokenUsage.input by usage.input
23:     INCREMENT this.sessionTokenUsage.output by usage.output
24:     INCREMENT this.sessionTokenUsage.cache by usage.cache
25:     INCREMENT this.sessionTokenUsage.tool by usage.tool
26:     INCREMENT this.sessionTokenUsage.thought by usage.thought
27:     INCREMENT this.sessionTokenUsage.total by (usage.input + usage.output + usage.cache + usage.tool + usage.thought)
28:   END METHOD
29: 
30:   METHOD resetSessionTokenUsage()
31:     RESET all fields in this.sessionTokenUsage to zero
32:   END METHOD
33: 
34:   METHOD getSessionTokenUsage(): object
35:     RETURN copy of this.sessionTokenUsage
36:   END METHOD
37: END CLASS