/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
interface SourceInitialLimits {
  readonly completionBudget: number;
  readonly compressionThreshold: number;
  readonly marginAdjustedLimit: number;
}

export async function enforceSourceInitialProjection(
  estimate: () => Promise<number>,
  limits: SourceInitialLimits,
): Promise<void> {
  let requestTokens: number;
  try {
    requestTokens = await estimate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Token projection failed at initial stage during provider-content hard-limit enforcement: ${message}`,
      { cause: error },
    );
  }
  const projected = requestTokens + limits.completionBudget;
  if (projected > limits.compressionThreshold) {
    throw new Error(
      `Disk source compression requires array replacement contracts; projected ${projected} exceeds compression threshold ${limits.compressionThreshold} (safety-adjusted limit ${limits.marginAdjustedLimit}, completion budget ${limits.completionBudget}).`,
    );
  }
}
