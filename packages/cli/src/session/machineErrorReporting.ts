const MACHINE_ERROR_REPORTED = Symbol('llxprt.machineErrorReported');

export function markMachineErrorReported(error: Error): void {
  Object.defineProperty(error, MACHINE_ERROR_REPORTED, { value: true });
}

export function wasMachineErrorReported(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    MACHINE_ERROR_REPORTED in error
  );
}
