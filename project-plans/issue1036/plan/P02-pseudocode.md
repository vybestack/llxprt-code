# Phase 02: Pseudocode

## Phase ID
`PLAN-20260211-SANDBOX1036.P02`

## Prerequisites
- Required: Phase P0.5 completed (preflight verification passed)

## Purpose
Create numbered pseudocode for all four fixes. This pseudocode will be
referenced line-by-line during implementation phases.

## Deliverable
Create file: `project-plans/issue1036/analysis/pseudocode/sandbox-changes.md`

## Pseudocode Requirements

### Section A: Error Message Fix (R1)
Numbered pseudocode for the string replacement in the image-pull failure path.
Include the exact old string and new string.

### Section B: Git Discovery Env Var (R2)
Numbered pseudocode for inserting `GIT_DISCOVERY_ACROSS_FILESYSTEM=1` into
the container args. Specify exact insertion point relative to existing env
var pushes.

### Section C: Git Config Mounts (R3)
Numbered pseudocode for the `mountGitConfigFiles` helper function:
```
INPUT: args (string array), homedir (string), containerHomePath (string)
OUTPUT: mutates args array with --volume entries

10: DEFINE gitConfigFiles as list of {hostRelPath, description}
11:   - ".gitconfig"
12:   - ".config/git/config"
13:   - ".gitignore_global"
14: FOR EACH file in gitConfigFiles
15:   SET hostPath = path.join(homedir, file.hostRelPath)
16:   IF fs.existsSync(hostPath)
17:     SET containerPath = getContainerPath(hostPath)
18:     PUSH args: '--volume', hostPath:containerPath:ro
19:     IF containerHomePath differs from homedir
20:       SET altPath = path.join(containerHomePath, file.hostRelPath)
21:       SET altContainerPath = getContainerPath(altPath)
22:       IF altContainerPath != containerPath
23:         PUSH args: '--volume', hostPath:altContainerPath:ro
```

### Section D: SSH Agent Platform Router (R4-R7)
Numbered pseudocode for `setupSshAgentForwarding` and its platform-specific
helpers:

#### D.1: setupSshAgentForwarding (router)
```
INPUT: config (SandboxConfig), args (string[])
OUTPUT: { tunnelProcess?: ChildProcess, cleanup?: () => void }

30: READ sshAgentSetting from env (LLXPRT_SANDBOX_SSH_AGENT || SANDBOX_SSH_AGENT)
31: COMPUTE shouldEnable using existing logic (on/off/auto+SSH_AUTH_SOCK)
32: IF NOT shouldEnable: RETURN {}
33: READ sshAuthSock from env
34: IF NOT sshAuthSock: WARN "SSH_AUTH_SOCK not set", RETURN {}
35: IF platform is linux:
36:   CALL setupSshAgentLinux(config, args, sshAuthSock)
37:   RETURN {}
38: IF platform is darwin AND config.command is 'docker':
39:   CALL setupSshAgentDockerMacOS(args)
40:   RETURN {}
41: IF platform is darwin AND config.command is 'podman':
42:   RETURN AWAIT setupSshAgentPodmanMacOS(args, sshAuthSock)
43: ELSE:
44:   CALL setupSshAgentLinux(config, args, sshAuthSock)
45:   RETURN {}
```

#### D.2: setupSshAgentLinux
```
50: SET containerSocket = '/ssh-agent'
51: SET mountSpec = sshAuthSock:containerSocket
52: IF config.command is 'podman' AND platform is 'linux':
53:   APPEND ':z' to mountSpec
54: PUSH args: '--volume', mountSpec
55: PUSH args: '--env', 'SSH_AUTH_SOCK=/ssh-agent'
```

#### D.3: setupSshAgentDockerMacOS
```
60: SET magicSocket = '/run/host-services/ssh-auth.sock'
61: TRY:
62:   RUN execSync('docker info --format {{.OperatingSystem}}')
63:   IF output does not contain 'Docker Desktop': THROW
64:   RUN execSync('docker run --rm -v magicSocket:/probe alpine test -S /probe')
65: CATCH:
66:   WARN "Docker Desktop not detected or magic socket unavailable"
67:   RETURN
68: PUSH args: '--volume', magicSocket:/ssh-agent
69: PUSH args: '--env', 'SSH_AUTH_SOCK=/ssh-agent'
```

#### D.4: setupSshAgentPodmanMacOS
```
70: SET VM_SOCKET_PATH = '/tmp/ssh-agent.sock'
71: RUN output = execSync('podman system connection list --format json')
72: PARSE connections from JSON
73: IF parse fails: THROW FatalSandboxError with remediation guidance
74: FIND default connection (or sole connection if exactly one)
75: IF no connection found: THROW FatalSandboxError with remediation guidance
76: EXTRACT sshUri and identityPath from connection
77: PARSE host, port, user from sshUri
78: RUN podman machine ssh: remove stale socket (best-effort)
79: SPAWN ssh process: ssh -i identityPath -p port user@host
80:   -R VM_SOCKET_PATH:sshAuthSock -N -o StrictHostKeyChecking=no
81: POLL for socket existence via podman machine ssh "test -S VM_SOCKET_PATH"
82:   WITH timeout (e.g., 10 seconds)
83: IF poll timeout: KILL tunnel, THROW FatalSandboxError
84: PUSH args: '--volume', VM_SOCKET_PATH:/ssh-agent
85: PUSH args: '--env', 'SSH_AUTH_SOCK=/ssh-agent'
86: CREATE cleanup function:
87:   KILL tunnel process (best-effort)
88:   RUN podman machine ssh: remove socket (best-effort, no throw)
89: RETURN { tunnelProcess, cleanup }
```

### Anti-Pattern Warnings
```
[ERROR] DO NOT: hardcode SSH socket paths for any platform other than constants
[ERROR] DO NOT: use fixed sleep() instead of polling for socket readiness
[ERROR] DO NOT: let tunnel cleanup throw on exit (must be best-effort)
[ERROR] DO NOT: skip the opt-in/opt-out check (R4.1, R4.2, R4.4)
[OK] DO: follow existing proxy process pattern for tunnel lifecycle
[OK] DO: use getContainerPath() for all path conversions
[OK] DO: use FatalSandboxError for all fail-fast errors
```

## Verification
- All pseudocode lines are numbered
- All requirements R1–R7 are traceable to pseudocode sections
- No actual TypeScript in pseudocode (algorithmic steps only)
- Error paths and cleanup defined for every operation
