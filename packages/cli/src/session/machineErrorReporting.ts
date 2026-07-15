const machineReportedErrors = new WeakSet<Error>();

export function markMachineErrorReported(error: Error): void {
  machineReportedErrors.add(error);
}

export function wasMachineErrorReported(error: unknown): boolean {
  return error instanceof Error && machineReportedErrors.has(error);
}
