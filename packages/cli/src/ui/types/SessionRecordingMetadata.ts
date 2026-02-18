/**
 * Session recording metadata type for UI components
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P21
 * @requirement REQ-SM-001
 */
export interface SessionRecordingMetadata {
  sessionId: string;
  filePath: string | null;
  startTime: string;
  isResumed: boolean;
}
