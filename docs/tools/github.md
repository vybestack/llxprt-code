# GitHub Tool

The `github` tool lets the model work with GitHub issues, pull requests,
checks and labels without ever holding a GitHub credential.

## Why it exists

Running `gh` from the shell requires a token the model can read. Inside a
sandbox that defeats the point: a prompt-injected or over-eager agent can echo
the token, encode it, or send it somewhere. The `github` tool moves the work to
the host instead. The model names an operation and supplies arguments; the host
runs `gh` and returns the result. **The credential never enters the sandbox.**

A second benefit falls out of the same design: because the host shapes the
response, the model gets structured data instead of raw JSON, so it no longer
has to write `--jq` expressions and no longer misses comments.

## Using it

Operation names mirror `gh` subcommands. Parameters mirror `gh` long flags with
the dashes removed — `--repo` becomes `repo`, `--limit` becomes `limit`. There
is no `--json` or `--jq`, because responses are already shaped.

```jsonc
{ "op": "issue.view", "number": 1663, "comments": true }
{ "op": "issue.list", "search": "sandbox", "state": "open", "limit": 20 }
{ "op": "pr.reviews", "number": 2317, "actionable": true }
{ "op": "pr.checks", "number": 2317, "watch": true }
```

### Working across repositories

Every operation takes an optional `repo` as `owner/name`. Omit it to use the
current repository.

```jsonc
{ "op": "issue.view", "number": 42, "repo": "acoliver/otherproject" }
```

This works for public repositories, private repositories on free plans, and any
account you have access to. It is not limited to GitHub Enterprise.

## Operations

### Reading

| Operation                     | What it does                                     |
| ----------------------------- | ------------------------------------------------ |
| `issue.view`                  | One issue, optionally with comments              |
| `issue.list`                  | Issues, filtered by `search`, `state`, `label`   |
| `pr.view`                     | One pull request, optionally with comments       |
| `pr.list`                     | Pull requests                                    |
| `pr.diff`                     | The unified diff                                 |
| `pr.checks`                   | CI check results; see **Watching checks** below  |
| `pr.reviews`                  | Review threads; see **Actionable reviews** below |
| `search.issues`, `search.prs` | Search across repositories                       |
| `run.list`                    | Workflow runs                                    |
| `label.list`                  | Labels                                           |

List results **exclude bodies** and default to 30 items (maximum 100). A long
list carrying full bodies is the fastest way to blow the response budget, and
it is rarely what you wanted.

### Writing

| Operation                                        | What it does                                                  |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `issue.create`, `issue.comment`, `issue.close`   | Create, comment, close                                        |
| `issue.edit`                                     | Title, body, labels, assignees, projects, milestone, **type** |
| `pr.create`, `pr.comment`, `pr.edit`, `pr.ready` | Create, comment, edit, mark ready                             |
| `pr.resolve-thread`                              | Resolve a review thread                                       |
| `label.create`                                   | Create a label                                                |

Write operations ask for confirmation before running, through the same
mechanism as every other tool — so your normal allow rules and "always allow"
choices apply.

## Actionable reviews

`pr.reviews` with `actionable: true` omits threads that are already resolved or
outdated, leaving only the comments that still need action. On a pull request
with a long automated review summary, this is the difference between a wall of
text and a short list.

The thread `id` it returns is exactly what `pr.resolve-thread` accepts, so the
two compose:

```jsonc
{ "op": "pr.reviews", "number": 2317, "actionable": true }
// ... address a comment ...
{ "op": "pr.resolve-thread", "threadId": "PRRT_kwDO..." }
```

## Watching checks

`pr.checks` with `watch: true` **blocks** until CI finishes and then returns the
result. The host runs the polling loop, so the model does not need to poll and
does not fight tool timeouts.

Polling is every 10 seconds for the first 30 seconds, then every 30 seconds.
Lint and format failures usually appear in the first minute, so the fast early
phase surfaces the common failure quickly, while the slower steady state keeps
API usage to roughly 2% of the hourly budget.

The watch ends when no check is still pending — **including when checks fail**.
It does not wait for red checks to turn green. Press Ctrl+C to cancel; the
host-side poller stops immediately.

## Issue types

`gh issue edit` can set labels, assignees, projects and milestones, but it has
no flag for issue type. `issue.edit` handles type as well, resolving the type
name against those the repository defines:

```jsonc
{
  "op": "issue.edit",
  "number": 1663,
  "type": "Feature",
  "addLabel": ["security"],
}
```

The name is matched case-insensitively. If the repository has no matching type,
the operation fails and tells you which types exist — it does not silently
succeed while leaving the type unset.

## Authentication

The tool uses whatever credential `gh` already has on the host. If
`gh auth status` works in your terminal, the tool works.

LLxprt never reads, stores or copies that credential. It runs `gh`, and `gh`
reads its own keyring entry.

> **Note on storing a token with `/key`:** this is deliberately not supported.
> A stored token is a durable, high-value secret sitting behind the sandbox
> boundary, whereas host `gh` auth leaves nothing for the broker to hand out
> even if something else goes wrong. See [Sandbox](../sandbox.md) for the
> reasoning.

## Errors

| Code                  | Meaning                                           |
| --------------------- | ------------------------------------------------- |
| `NOT_FOUND`           | No such issue, pull request or repository         |
| `PERMISSION_DENIED`   | The credential lacks access                       |
| `RATE_LIMITED`        | GitHub rate limit hit; retry later                |
| `HOST_AUTH_REQUIRED`  | `gh` is not authenticated on the host             |
| `HOST_GH_UNAVAILABLE` | `gh` is not installed on the host                 |
| `INVALID_PARAM`       | A parameter was rejected before the call was made |
| `UNKNOWN_OP`          | No such operation                                 |

## Sandboxed vs. not

The tool behaves identically either way. Inside a sandbox the request travels to
the host over the existing authenticated credential channel; outside one it runs
in the same process. The operation set and the responses are the same, so there
is no behaviour that only appears in one mode.

Under Docker or Podman this is the **only** way to reach GitHub, because no
credential exists in the container for `gh` to use.

> **Seatbelt is different.** It runs on the host with your full keyring rather
> than isolating credentials, so `gh` there is already authenticated and the
> tool provides convenience and shaped output rather than a boundary. See
> [Sandbox](../sandbox.md) for why Docker or Podman is recommended.
