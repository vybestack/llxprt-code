/** Utility type for Node.js file system errors to avoid `any` */
export interface NodeJSError extends Error {
  code?: string;
} // @plan:PLAN-20250117-SUBAGENTCONFIG.P05 @requirement:REQ-002
