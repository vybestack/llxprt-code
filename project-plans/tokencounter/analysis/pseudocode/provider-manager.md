# Pseudocode: ProviderManager Enhancements

10: CLASS ProviderManager
11:   PROPERTY providers: Map<string, Provider>
12:   PROPERTY sessionTokenUsage: Map<string, SessionTokenUsage>
13: 
14: 20: METHOD initialize(providerName: string)
25:   IF providers does not contain providerName
26:     THROW Error("Provider not registered")
27: 
30:   INITIALIZE sessionTokenUsage entry for providerName:
31:   sessionTokenUsage.set(providerName, { input: 0, output: 0, cache: 0, tool: 0, thought: 0, total: 0 })
32: 
40: 50: METHOD accumulateSessionTokens(providerName: string, usage: { input: number, output: number, cache?: number, tool?: number, thought?: number })
60:   VALIDATE providerName exists in providers
61:   IF validation fails
62:     THROW Error("Provider not registered")
63: 
65: 70:   VALIDATE usage values are non-negative integers
76:   IF validation fails
77:     THROW ValidationError with details
78:     
80:  GET currentSessionUsage = sessionTokenUsage.get(providerName)
85:  IF currentSessionUsage is null
86:    THROW Error("Provider session not initialized")
87:    
90:  UPDATE currentSessionUsage:
95:   input += usage.input
96:   output += usage.output
97:   cache += usage.cache || 0
98:   tool += usage.tool || 0
99:   thought += usage.thought || 0
100:  total = input + output + cache + tool + thought
105: 
110:  UPDATE sessionTokenUsage with currentSessionUsage
115:  RETURN currentSessionUsage
120: 
125: 130: METHOD getSessionTokenUsage(providerName: string): SessionTokenUsage | null
135:  RETURN sessionTokenUsage.get(providerName) || null
140:  
145: 150: INTERFACE SessionTokenUsage
155:  PROPERTY input: number
160:  PROPERTY output: number
165:  PROPERTY cache: number
170:  PROPERTY tool: number
175:  PROPERTY thought: number
180:  PROPERTY total: number