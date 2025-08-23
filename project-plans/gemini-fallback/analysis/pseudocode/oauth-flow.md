# Pseudocode: OAuth Flow for Gemini Provider

01: FUNCTION initiateGeminiOAuth()
02:   CALL getAuthToken()
03:   IF token is API key
04:     RETURN token
05:   ELSE IF token is 'USE_LOGIN_WITH_GOOGLE'
06:     CALL createCodeAssistContentGenerator() to get authUrl
07:     TRY to open browser with authUrl
08:       CALL openBrowserSecurely(authUrl)
09:       RETURN authenticated client for normal flow
10:     CATCH browser opening error
11:       CALL copyToClipboard(authUrl)
12:       IF clipboard copy succeeds
13:         SET global var __oauth_needs_code = true
14:         SET global var __oauth_provider = 'gemini'
15:         WAIT for verification code submission from dialog
16:         CALL exchangeCodeForTokens(verificationCode)
17:         RESET global state variables
18:         RETURN authenticated client
19:       ELSE
20:         PRINT authUrl to console in clean format
21:         SET global var __oauth_needs_code = true
22:         SET global var __oauth_provider = 'gemini'
23:         WAIT for verification code submission from dialog
24:         CALL exchangeCodeForTokens(verificationCode)
25:         RESET global state variables
26:         RETURN authenticated client
27:   END IF
28: END FUNCTION

29: FUNCTION copyToClipboard(text)
30:   DETECT platform (macOS, Linux, Windows)
31:   SELECT appropriate clipboard utility
32:     macOS: pbcopy
33:     Linux: xclip OR wl-clipboard 
34:     Windows: clip
35:   EXECUTE clipboard utility command with text
36:   RETURN success status
37: END FUNCTION

38: FUNCTION handleOAuthCodeDialog(provider, onClose, onSubmit)
39:   RENDER dialog component with provider-specific instructions
40:   IF provider === 'gemini'
41:     DISPLAY instructions about clipboard copy and browser paste
42:   ELSE
43:     DISPLAY standard instructions for authorize in browser
44:   END IF
45:   
46:   HANDLE input events:
47:     IF key is Escape
48:       CALL onClose() 
49:       RETURN
50:     END IF
51:     
52:     IF key is Return
53:       IF code input is valid
54:         CALL onSubmit(code)
55:         CALL onClose()
56:       END IF
57:       RETURN
58:     END IF
59:     
60:     IF key is paste operation
61:       FILTER paste content to valid OAuth code characters
62:       UPDATE code state with filtered content
63:       RETURN
64:     END IF
65:   END FUNCTION
66: END FUNCTION

67: FUNCTION exchangeVerificationCode(provider, code)
68:   CALL provider OAuth service to exchange code
69:   IF response contains error
70:     THROW OAuthExchangeError with details
71:   ELSE
72:     CACHE received tokens
73:     RETURN success
74:   END IF
75: END FUNCTION

76: FUNCTION cancelOAuthProcess()
77:   RESET global state variables (__oauth_needs_code, __oauth_provider)
78:   THROW OAuthCancelledError 
79: END FUNCTION