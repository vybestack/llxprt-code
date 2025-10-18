# Codex Worker Orchestration Guide

This document captures the standard operating procedure for driving long-lived plans via external Codex workers. The approach keeps each worker’s context clean, prevents runaway processes, and ensures we can recover gracefully when a worker fails or stalls.

> **Note:** The `--dangerously-bypass-approvals-and-sandbox` flag on `codex exec` is intentionally dramatic. We use it in this secure environment to grant the worker full access to the repository; always mention this when onboarding new teammates so they understand the context.

---

## 1. Launching Workers

For every phase (stub, test, implementation, verification), launch a fresh worker process and track its PID:

```bash
# Capture timestamp for audit trail
date +"%Y-%m-%dT%H:%M:%S%z"

WORKER_PXX_PID=$(codex exec --dangerously-bypass-approvals-and-sandbox 'run phase command here' \
  > tmp/worker-PXX-$$.log 2>&1 & echo $!)

echo "PXX PID: $WORKER_PXX_PID" >> tmp/statelessprovider-worker-pids.txt
```

- **Log file:** Each worker redirects stdout/stderr to `tmp/worker-PXX-*.log`, so we can inspect activity even if the worker dies.
- **PID tracking:** Keep appending to `tmp/statelessprovider-worker-pids.txt` so we can monitor/cleanup multiple workers if necessary.

## 2. Polling & Timeout Policy

We poll the worker at five-minute intervals (maximum of six cycles = 30 minutes) before taking remedial action.

```bash
for i in {1..6}; do
  date +"%Y-%m-%dT%H:%M:%S%z"
  sleep 300   # 5 minutes
  if ! ps -p "$WORKER_PXX_PID" > /dev/null; then
    echo "Worker PXX completed"
    break
  fi
done
```

- If the worker finishes before 30 minutes, move on to inspection (see §3).
- If the worker is still running after six sleeps, treat it as hung: gather logs, consider terminating the PID, and spawn a remediation worker.

Judgement still matters—if a phase is known to take longer (e.g., massive TDD suite), extend the polling loop, but always log the timestamps so future reviewers understand the delays.

## 3. Inspecting Worker Output

When a worker exits, review:

1. Worker log (`tmp/worker-PXX-*.log`) for runtime errors.
2. Phase report (e.g., `project-plans/.../reports/PXX-worker.md`) to confirm the worker recorded PASS/FAIL status, verification commands, and timestamps.
3. Completion artifact (e.g., `project-plans/.../.completed/PXX.md`) to ensure verification data was captured.

If the worker declared success, proceed to the next phase. If it failed:

- Read the failure reason.
- Launch a remediation worker to address the issue (e.g., fix failing tests, rerun verification).
- Record the remediation PID in the same PID file for traceability.

## 4. Remediation Workers

Remediation workers follow the same launch/poll/inspect flow but focus on fixing specific failures (missing verification output, failing tests, etc.). Always:

- Reference the original worker log to avoid duplicating work.
- Update the phase report/completion marker once remediation succeeds.
- Note the remediation PID and outcome in the PID log (`tmp/statelessprovider-worker-pids.txt`).

## 5. Preserving Coordinator Context

A key reason for outsourcing to workers is to avoid bloating the coordinator’s own context. Keep the coordinator’s actions lightweight:

- Launch workers, poll status, inspect outputs.
- Avoid running heavy tests or scripts directly in the coordinator session.
- Archive worker logs and completion artifacts so future coordinators have a clean audit trail.

## 6. Logging & Audit Trail

Standard logging requirements:

- Prepend every sleep/poll cycle with `date +"%Y-%m-%dT%H:%M:%S%z"`.
- When a worker finishes (success or failure), log the outcome with a timestamp.
- Retain `tmp/statelessprovider-worker-pids.txt` until the entire plan completes, then archive it alongside the plan reports.

## 7. Completion Checkpoints

Before moving to the next phase, verify:

1. `reports/PXX-worker.md` exists and reflects the worker’s final status.
2. `.completed/PXX.md` (and `.completed/PXXa.md`) contain command output, timestamps, and plan markers.
3. The code/tests now match the expected state (e.g., stubs in stub phase, failing tests in test phase, passing tests in implementation/verification).

Only after these conditions are met should the coordinator launch the worker for the next phase.

---

Following this workflow ensures we can execute large plans (like PLAN-20251018-STATELESSPROVIDER2) reliably, maintain a clean audit trail, and keep the primary coordinator context light. Feel free to reuse this guide for any future multi-phase efforts.။
