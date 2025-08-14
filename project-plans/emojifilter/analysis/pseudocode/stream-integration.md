# Pseudocode: Stream Integration

```
01: MODULE StreamIntegration
02:
03: METHOD integrateWithStream(useGeminiStream: Hook): void
04:   SET emojiFilter = null
05:   SET config = useGeminiStream.config
06:   
07:   // Initialize filter on first use
08:   FUNCTION getOrCreateFilter(): EmojiFilter
09:     IF emojiFilter === null
10:       SET mode = getEmojiFilterMode(config)
11:       SET filterConfig = { mode: mode }
12:       SET emojiFilter = new EmojiFilter(filterConfig)
13:     END IF
14:     RETURN emojiFilter
15:   END FUNCTION
16:   
17:   // Modify processGeminiStreamEvents at line 816
18:   WRAP processGeminiStreamEvents WITH FUNCTION(original)
19:     RETURN ASYNC FUNCTION(stream, timestamp, signal)
20:       SET filter = getOrCreateFilter()
21:       SET modifiedStream = createFilteredStream(stream, filter)
22:       RETURN original(modifiedStream, timestamp, signal)
23:     END FUNCTION
24:   END WRAP
25: END METHOD
26:
27: METHOD createFilteredStream(originalStream, filter): AsyncIterator
28:   RETURN ASYNC GENERATOR
29:     FOR AWAIT chunk OF originalStream
30:       IF chunk.type === 'content'
31:         SET result = filter.filterStreamChunk(chunk.text)
32:         IF result.blocked
33:           // In error mode, stop the stream
34:           THROW new Error(result.error)
35:         END IF
36:         
37:         // Emit filtered content
38:         YIELD {
39:           ...chunk,
40:           text: result.filtered
41:         }
42:         
43:         // In warn mode, emit system feedback
44:         IF result.systemFeedback
45:           YIELD {
46:             type: 'system',
47:             text: result.systemFeedback
48:           }
49:         END IF
50:       ELSE
51:         // Pass through non-content chunks
52:         YIELD chunk
53:       END IF
54:     END FOR
55:     
56:     // Flush any remaining buffer
57:     SET remaining = filter.flushBuffer()
58:     IF remaining.length > 0
59:       YIELD {
60:         type: 'content',
61:         text: remaining
62:       }
63:     END IF
64:   END GENERATOR
65: END METHOD
66:
67: END MODULE
```