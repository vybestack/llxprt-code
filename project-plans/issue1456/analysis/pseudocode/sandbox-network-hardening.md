# Numbered Pseudocode: Issue #1456 Sandbox Network Hardening

Plan ID: `PLAN-20260801-ISSUE1456`

The implementation phase must cite these stable pseudocode identifiers in its work log and compare final behavior against them. These are algorithm identifiers, not physical source positions.

## PS-1456-01 — Seatbelt profile selection and fail-fast validation

```text
PS-1456-01.001  FUNCTION runSeatbeltSandbox(existing arguments)
PS-1456-01.002    IF BUILD_SANDBOX is set
PS-1456-01.003      THROW existing FatalSandboxError
PS-1456-01.004    END IF
PS-1456-01.005
PS-1456-01.006    READ explicitProfile from SEATBELT_PROFILE
PS-1456-01.007    IF explicitProfile is defined AND explicitProfile length is greater than zero
PS-1456-01.008      selectedProfile := explicitProfile
PS-1456-01.009    ELSE
PS-1456-01.010      effectiveNetwork := LLXPRT_SANDBOX_NETWORK ?? SANDBOX_NETWORK
PS-1456-01.011      IF effectiveNetwork equals "off"
PS-1456-01.012        selectedProfile := "permissive-closed"
PS-1456-01.013      ELSE IF effectiveNetwork equals "proxied"
PS-1456-01.014        selectedProfile := "permissive-proxied"
PS-1456-01.015      ELSE
PS-1456-01.016        selectedProfile := "permissive-open"
PS-1456-01.017      END IF
PS-1456-01.018    END IF
PS-1456-01.019    STORE selectedProfile in SEATBELT_PROFILE for existing runtime/about visibility
PS-1456-01.020
PS-1456-01.021    IF selectedProfile equals "permissive-proxied" OR "restrictive-proxied"
PS-1456-01.022      READ proxyCommand from LLXPRT_SANDBOX_PROXY_COMMAND
PS-1456-01.023      IF proxyCommand is undefined OR trim(proxyCommand) is empty
PS-1456-01.024        THROW FatalSandboxError naming proxied mode and required variable
PS-1456-01.025      END IF
PS-1456-01.026    END IF
PS-1456-01.027
PS-1456-01.028    PRESERVE arbitrary explicit custom profile behavior without inferring network intent from its name
PS-1456-01.029
PS-1456-01.030    IF selectedProfile is a built-in profile
PS-1456-01.031      profileFile := existing module-relative sandbox-macos-<selectedProfile>.sb path
PS-1456-01.032    ELSE
PS-1456-01.033      profileFile := existing custom .llxprt/sandbox-macos-<selectedProfile>.sb path
PS-1456-01.034    END IF
PS-1456-01.035    VERIFY profileFile exists using existing fatal behavior
PS-1456-01.036    BUILD Seatbelt args with profileFile
PS-1456-01.037    SET UP existing Seatbelt proxy lifecycle
PS-1456-01.038    SPAWN Seatbelt with existing scrubbed child environment
PS-1456-01.039    RETURN existing normalized child exit result
PS-1456-01.040  END FUNCTION
```

Implementation references: `packages/cli/src/utils/sandbox-seatbelt.ts::runSeatbeltSandbox`; tests must enter through the same exported function.

## PS-1456-02 — Container proxied policy validation

```text
PS-1456-02.001  FUNCTION buildContainerRunArgs(existing arguments)
PS-1456-02.002    BUILD existing base run args, custom flags, and resource limits
PS-1456-02.003    effectiveNetwork := LLXPRT_SANDBOX_NETWORK ?? SANDBOX_NETWORK
PS-1456-02.004
PS-1456-02.005    IF effectiveNetwork equals "off"
PS-1456-02.006      APPEND "--network", "none"
PS-1456-02.007    ELSE IF effectiveNetwork equals "proxied"
PS-1456-02.008      READ proxyCommand from LLXPRT_SANDBOX_PROXY_COMMAND
PS-1456-02.009      IF proxyCommand is undefined OR trim(proxyCommand) is empty
PS-1456-02.010        THROW FatalSandboxError naming proxied mode and required variable
PS-1456-02.011      END IF
PS-1456-02.012      DO NOT append default-network fallback args
PS-1456-02.013      DO NOT emit the old unimplemented/fallback warning
PS-1456-02.014    END IF
PS-1456-02.015
PS-1456-02.016    APPEND all existing TTY, volume, settings, git, and temp mounts
PS-1456-02.017    RETURN args
PS-1456-02.018  END FUNCTION
```

```text
PS-1456-02.019  FUNCTION setupContainerNetworking(existing arguments)
PS-1456-02.020    READ original proxyCommand from LLXPRT_SANDBOX_PROXY_COMMAND
PS-1456-02.021    IF existing non-empty-command condition succeeds
PS-1456-02.022      PRESERVE existing proxy URL rewrite and proxy environment args
PS-1456-02.023      INSPECT OR CREATE existing internal llxprt-code-sandbox network
PS-1456-02.024      APPEND "--network", "llxprt-code-sandbox"
PS-1456-02.025      INSPECT OR CREATE existing llxprt-code-sandbox-proxy network
PS-1456-02.026    END IF
PS-1456-02.027    PRESERVE existing port publication behavior
PS-1456-02.028    RETURN original proxyCommand
PS-1456-02.029  END FUNCTION
```

```text
PS-1456-02.030  FUNCTION existing executeContainerSandbox path
PS-1456-02.031    IF returned proxyCommand is defined
PS-1456-02.032      CALL existing startProxyContainer with command unchanged
PS-1456-02.033      EXISTING proxy container joins proxy network
PS-1456-02.034      EXISTING network-connect joins proxy container to internal sandbox network
PS-1456-02.035    END IF
PS-1456-02.036    SPAWN sandbox container only after preparation succeeds
PS-1456-02.037  END FUNCTION
```

Implementation references: `packages/cli/src/utils/sandbox-containers.ts::buildContainerRunArgs`; preserve `setupContainerNetworking` and `startProxyContainer` architecture rather than replacing it.

## PS-1456-03 — Darwin network-off credential proxy rejection

```text
PS-1456-03.001  FUNCTION setupCredentialProxy(existing arguments)
PS-1456-03.002    effectiveNetwork := LLXPRT_SANDBOX_NETWORK ?? SANDBOX_NETWORK
PS-1456-03.003    isDarwinContainer := os.platform is "darwin" AND command is Docker or Podman
PS-1456-03.004
PS-1456-03.005    IF isDarwinContainer AND effectiveNetwork equals "off"
PS-1456-03.006      THROW FatalSandboxError explaining:
PS-1456-03.007        macOS credential bridge requires container networking
PS-1456-03.008        supported action is enable networking or use Linux for network-off
PS-1456-03.009      DO NOT start credential proxy
PS-1456-03.010      DO NOT create TCP bridge or SSH tunnel
PS-1456-03.011      DO NOT create capability env file
PS-1456-03.012      DO NOT mutate args, entrypoint prefixes, or reserved ports
PS-1456-03.013    END IF
PS-1456-03.014
PS-1456-03.015    PRESERVE existing createAndStartProxy and socket invariant behavior
PS-1456-03.016    IF Darwin
PS-1456-03.017      PRESERVE existing Docker/Podman bridge setup
PS-1456-03.018    ELSE
PS-1456-03.019      PRESERVE direct host Unix socket path under mounted temp directory
PS-1456-03.020    END IF
PS-1456-03.021    APPEND LLXPRT_CREDENTIAL_SOCKET using effective socket path
PS-1456-03.022    PRESERVE capability env-file creation and cleanup composition
PS-1456-03.023    RETURN existing result
PS-1456-03.024  END FUNCTION
```

Implementation references: `packages/cli/src/utils/sandbox-containers.ts::setupCredentialProxy`. The guard is the first resource-affecting decision inside the function.

## PS-1456-04 — Podman macOS SSH conflict before tunnel allocation

```text
PS-1456-04.001  FUNCTION checkPodmanHostNetworkForSshAgent(args)
PS-1456-04.002    FIND first "--network" argument
PS-1456-04.003    IF no network argument exists
PS-1456-04.004      RETURN state indicating host mode may be added after tunnel succeeds
PS-1456-04.005    END IF
PS-1456-04.006    existingNetwork := value following "--network"
PS-1456-04.007    IF existingNetwork equals "host"
PS-1456-04.008      RETURN state indicating host mode already exists
PS-1456-04.009    END IF
PS-1456-04.010    WARN that SSH forwarding requires host mode and existing mode is retained
PS-1456-04.011    RETURN conflict
PS-1456-04.012  END FUNCTION
```

```text
PS-1456-04.013  FUNCTION setupSshAgentPodmanMacOS(existing arguments)
PS-1456-04.014    networkDecision := checkPodmanHostNetworkForSshAgent(args)
PS-1456-04.015    IF networkDecision is conflict
PS-1456-04.016      RETURN empty result
PS-1456-04.017    END IF
PS-1456-04.018
PS-1456-04.019    START existing Podman reverse tunnel
PS-1456-04.020    IF networkDecision says host mode absent
PS-1456-04.021      APPEND "--network", "host"
PS-1456-04.022    END IF
PS-1456-04.023    BUILD and RETURN existing SSH bridge result
PS-1456-04.024  END FUNCTION
```

The private network decision may instead directly append host mode before tunnel startup if that preserves failure cleanup semantics; the mandatory invariant is that a conflict returns before connection lookup/port reservation/spawn and that successful no-flag/host behavior remains unchanged. Do not retain a `ChildProcess` parameter on a pure preflight decision.

Implementation references: `packages/cli/src/utils/sandbox-podman.ts::ensurePodmanHostNetworkForSshAgent` and `::setupSshAgentPodmanMacOS`.

## PS-1456-05 — Behavioral test sequence

```text
PS-1456-05.001  SNAPSHOT relevant process environment before each suite
PS-1456-05.002  RESTORE environment and infrastructure mocks after each case
PS-1456-05.003
PS-1456-05.004  ADD Seatbelt behavior cases through real runSeatbeltSandbox
PS-1456-05.005    OBSERVE actual -f profile path and verify mapped built-in file exists
PS-1456-05.006    COVER explicit override, off, proxied, on, unset, and legacy fallback
PS-1456-05.007    COVER invalid proxied missing, empty, and whitespace commands
PS-1456-05.008    ASSERT FatalSandboxError and zero proxy/sandbox child spawns
PS-1456-05.009    RETAIN custom profile and child-env scrubbing regressions
PS-1456-05.010
PS-1456-05.011  ADD container behavior cases through buildContainerRunArgs/setupContainerNetworking
PS-1456-05.012    COVER invalid proxied command variants and zero network setup
PS-1456-05.013    COVER valid command yielding existing isolated network args and returned command
PS-1456-05.014    COVER off, on, unset, and primary-over-legacy behavior
PS-1456-05.015
PS-1456-05.016  ADD credential cases through real setupCredentialProxy
PS-1456-05.017    COVER Darwin Docker off and Darwin Podman off fatal failures
PS-1456-05.018    ASSERT no proxy/bridge resources and no mutable output changes
PS-1456-05.019    COVER Linux off direct socket success
PS-1456-05.020    COVER Darwin on/unset bridge success and cleanup
PS-1456-05.021
PS-1456-05.022  UPDATE Podman macOS SSH conflict case
PS-1456-05.023    ASSERT warning, empty result, preserved network-none args, and zero spawn
PS-1456-05.024    RETAIN adjacent no-flag/host success coverage
PS-1456-05.025
PS-1456-05.026  RUN tests before production changes
PS-1456-05.027  CONFIRM failures are behavioral mismatches from issue #1456, not test defects
PS-1456-05.028  ONLY THEN implement PS-1456-01 through PS-1456-04
```

## PS-1456-06 — Documentation update

```text
PS-1456-06.001  UPDATE docs/sandbox.md security overview and operational details
PS-1456-06.002  UPDATE docs/cli/sandbox-profiles.md reference semantics
PS-1456-06.003  REMOVE every claim that proxied mode silently falls back or is unimplemented
PS-1456-06.004  EXPLAIN existing proxy network/container path without inventing new architecture
PS-1456-06.005  EXPLAIN Darwin container network-off credential limitation and Linux support
PS-1456-06.006  EXPLAIN Seatbelt mapping and explicit profile override
PS-1456-06.007  EXPLAIN Podman macOS SSH network conflict before tunnel creation
PS-1456-06.008  UPDATE only directly contradicted tutorial sentence if needed
PS-1456-06.009  VERIFY links, terminology, and behavior against production tests
```
