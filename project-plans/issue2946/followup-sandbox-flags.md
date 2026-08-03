Split out from #2946. That issue removed the automatic forwarding of Google credentials into the container sandbox. This one is a separate route by which a repository — not the user — can re-introduce that forwarding.

## The problem

`packages/cli/src/config/config.ts` unconditionally calls the environment loader, and `packages/cli/src/config/environmentLoader.ts` selects a project-level `.env` and hands it straight to `dotenv.config()` with no exclusion list for sandbox launcher control variables.

`packages/cli/src/utils/sandbox-containers.ts` then shell-parses `SANDBOX_FLAGS` and appends the result verbatim to the Docker/Podman argument list.

The consequence: checking out a repository that contains a `.env` with

    SANDBOX_FLAGS=--env GEMINI_API_KEY

causes the container engine to inherit the host's ambient `GEMINI_API_KEY`, undoing the #2946 fix without the user choosing anything. The same route allows `--env-file`, `--volume` (re-mounting `~/.config/gcloud` or an ADC file), and any other engine flag.

## Why this is different from the accepted escape hatches

`SANDBOX_ENV`, `LLXPRT_SANDBOX_MOUNTS` / `SANDBOX_MOUNTS`, profile `mounts`, and a manually exported `SANDBOX_FLAGS` are all explicit user choices, and #2946 deliberately left them alone. The defect here is that an untrusted project directory silently gains control of the host launcher, which is not a user choice at all.

## Suggested resolution

Prevent project-level env files from setting sandbox launcher and control variables — at minimum `SANDBOX_FLAGS`, `SANDBOX_ENV`, the mount variables, and the engine / network / resource controls — while preserving values the user explicitly exported in their shell or set in a profile. Apply folder-trust checks before launcher controls are consumed.

## Acceptance criteria

- A project `.env` setting `SANDBOX_FLAGS` does not influence the generated container run arguments.
- The same applies to `SANDBOX_ENV` and the mount variables.
- A shell-exported or profile-supplied `SANDBOX_FLAGS` continues to work.
- A behavioral test uses a real project `.env` plus an ambient sentinel API key and proves the sentinel never reaches the generated run arguments.
