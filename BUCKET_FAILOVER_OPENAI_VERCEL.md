# OpenAIVercelProvider Bucket Failover Analysis

## Issue #686 - Bucket Failover Integration

### Provider: OpenAIVercelProvider

**Status**: Not Integrated

**Reason**:
OpenAIVercelProvider uses the Vercel AI SDK's built-in `streamText()` and `generateText()` functions, which have their own internal retry logic. These functions do not expose hooks or callbacks for integrating our bucket failover mechanism.

**Implementation Details**:

- The provider calls `streamText()` and `generateText()` from the AI SDK directly (lines 1011, 1515)
- These functions handle retries internally without using our `retryWithBackoff()` utility
- The SDK does not provide a mechanism to inject custom retry logic or failover callbacks

**Options for Future Integration**:

1. **Wrapper Approach**: Wrap the SDK calls in our own retry logic with bucket failover, but this would duplicate the SDK's built-in retry mechanism
2. **SDK Feature Request**: Request the Vercel AI SDK team to add support for custom retry callbacks
3. **Accept Limitation**: Document that bucket failover is not available for OpenAIVercelProvider

**Recommendation**:
Accept this limitation for now. OpenAIVercelProvider is a specialized implementation using a third-party SDK that handles retries differently. The main OpenAIProvider (which most users will use) has full bucket failover support.

**Alternative Workaround**:
Users requiring bucket failover for OpenAI models should use the standard OpenAIProvider instead of OpenAIVercelProvider.

---

**Related Files**:

- `/packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` (lines 1011, 1515)
- Issue #686

**Plan Reference**: PLAN-20251213issue686
