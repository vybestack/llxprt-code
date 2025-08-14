# Pseudocode: Configuration Integration

```
01: MODULE ConfigurationIntegration
02:
03: METHOD getEmojiFilterMode(config: Config): string
04:   SET settingsService = config.getSettingsService()
05:   IF settingsService === null
06:     RETURN 'auto'  // Default mode
07:   END IF
08:   
09:   SET mode = settingsService.get('emojiFilter.mode')
10:   IF mode === undefined OR mode === null
11:     RETURN 'auto'
12:   END IF
13:   
14:   IF mode NOT IN ['allowed', 'auto', 'warn', 'error']
15:     LOG warning: "Invalid emoji filter mode: " + mode
16:     RETURN 'auto'
17:   END IF
18:   
19:   RETURN mode
20: END METHOD
21:
22: METHOD setEmojiFilterMode(config: Config, mode: string): boolean
23:   IF mode NOT IN ['allowed', 'auto', 'warn', 'error']
24:     THROW ValidationError("Invalid mode: " + mode)
25:   END IF
26:   
27:   SET settingsService = config.getSettingsService()
28:   IF settingsService === null
29:     LOG error: "Settings service not available"
30:     RETURN false
31:   END IF
32:   
33:   TRY
34:     settingsService.set('emojiFilter.mode', mode)
35:     RETURN true
36:   CATCH error
37:     LOG error: "Failed to set emoji filter mode: " + error
38:     RETURN false
39:   END TRY
40: END METHOD
41:
42: METHOD handleSetCommand(args: string[]): CommandResult
43:   IF args[0] !== 'emojifilter'
44:     RETURN { handled: false }
45:   END IF
46:   
47:   IF args.length < 2
48:     RETURN { 
49:       handled: true, 
50:       error: "Usage: /set emojifilter <allowed|auto|warn|error>" 
51:     }
52:   END IF
53:   
54:   SET mode = args[1]
55:   TRY
56:     SET success = setEmojiFilterMode(config, mode)
57:     IF success
58:       RETURN { 
59:         handled: true, 
60:         message: "Emoji filter mode set to: " + mode 
61:       }
62:     ELSE
63:       RETURN { 
64:         handled: true, 
65:         error: "Failed to set emoji filter mode" 
66:       }
67:     END IF
68:   CATCH error
69:     RETURN { 
70:       handled: true, 
71:       error: error.message 
72:     }
73:   END TRY
74: END METHOD
75:
76: END MODULE
```