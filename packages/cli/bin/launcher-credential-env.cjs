'use strict';

const BUN_RELAUNCH_ENV = 'LLXPRT_BUN_RELAUNCHED';
const CREDENTIAL_SOCKET_ENV = 'LLXPRT_CREDENTIAL_SOCKET';
// Prefix for the sidecar's per-launch socket directory (created via
// mkdtemp(join(tmpdir(), PROXY_SOCKET_PREFIX))). Shared here so the sidecar and
// the parent launcher agree on the directory-ownership check without drift.
const PROXY_SOCKET_PREFIX = 'lxcp-';

function hasUsableCredentialSocket(env = process.env) {
  const socketPath = env[CREDENTIAL_SOCKET_ENV];
  return typeof socketPath === 'string' && socketPath.length > 0;
}

function createLauncherChildEnv({
  env = process.env,
  credentialSocketPath = null,
}) {
  const childEnv = {
    ...env,
    [BUN_RELAUNCH_ENV]: 'true',
  };
  // Only forward a non-empty socket path. An empty string would set an unusable
  // CREDENTIAL_SOCKET_ENV on the child, so treat it the same as "no socket",
  // consistent with hasUsableCredentialSocket().
  if (
    typeof credentialSocketPath === 'string' &&
    credentialSocketPath.length > 0
  ) {
    childEnv[CREDENTIAL_SOCKET_ENV] = credentialSocketPath;
  }
  return childEnv;
}

module.exports = {
  BUN_RELAUNCH_ENV,
  CREDENTIAL_SOCKET_ENV,
  PROXY_SOCKET_PREFIX,
  createLauncherChildEnv,
  hasUsableCredentialSocket,
};
