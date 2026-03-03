import { describe, it, expect, afterEach } from 'vitest';
import { isContainerSandbox } from './containerSandbox.js';

describe('isContainerSandbox', () => {
  afterEach(() => {
    delete process.env.SANDBOX;
  });

  it('returns false when SANDBOX is not set', () => {
    delete process.env.SANDBOX;

    expect(isContainerSandbox()).toBe(false);
  });

  it('returns true when SANDBOX is set to a container name', () => {
    process.env.SANDBOX = 'sandbox-0.9.0-nightly';

    expect(isContainerSandbox()).toBe(true);
  });

  it('returns false when SANDBOX is set to sandbox-exec', () => {
    process.env.SANDBOX = 'sandbox-exec';

    expect(isContainerSandbox()).toBe(false);
  });

  it('returns true when SANDBOX is set to an empty string', () => {
    process.env.SANDBOX = '';

    expect(isContainerSandbox()).toBe(false);
  });

  it('returns true when SANDBOX is set to docker', () => {
    process.env.SANDBOX = 'docker';

    expect(isContainerSandbox()).toBe(true);
  });

  it('returns true when SANDBOX is set to podman', () => {
    process.env.SANDBOX = 'podman';

    expect(isContainerSandbox()).toBe(true);
  });
});
