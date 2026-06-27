#!/usr/bin/env bash
#
# tmux helpers for the issue #2182 mixed-provider load-balancer profiles
# (opusfirst, gptfirst, glm).
#
# Usage:
#   scripts/lb-profiles-tmux.sh launch [profile]   # open an interactive tmux
#                                                  # session per profile
#   scripts/lb-profiles-tmux.sh smoke  [profile]   # non-interactive prompt,
#                                                  # assert no 400 leak
#
# A "profile" is one of: opusfirst, gptfirst, glm. Omit to target all three.
#
# Why tmux: `node scripts/start.js` keeps stdin as a TTY inside tmux so it
# stays interactive (piping stdin would force non-interactive mode). This
# lets you drive each profile by hand to reproduce/verify the failover fix.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

ALL_PROFILES=(opusfirst gptfirst glm)
MODE="${1:-launch}"
PROFILE_ARG="${2:-}"

# Validate the optional profile argument against the allow-list so typos or
# anything containing shell metacharacters cannot reach the tmux/ node command.
if [[ -n "${PROFILE_ARG}" ]]; then
  valid=0
  for candidate in "${ALL_PROFILES[@]}"; do
    if [[ "${PROFILE_ARG}" == "${candidate}" ]]; then
      valid=1
      break
    fi
  done
  if [[ ${valid} -eq 0 ]]; then
    echo "Unknown profile '${PROFILE_ARG}'. Valid: ${ALL_PROFILES[*]}" >&2
    exit 2
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: 'node' was not found on PATH." >&2
  exit 127
fi

if [[ "${MODE}" == "smoke" ]]; then
  PROFILES=("${ALL_PROFILES[@]}")
  if [[ -n "${PROFILE_ARG}" ]]; then PROFILES=("${PROFILE_ARG}"); fi

  # Aggregate results across all profiles instead of aborting on the first
  # failure, so a transient issue with one provider does not hide the rest.
  smoke_failed=0

  for p in "${PROFILES[@]}"; do
    echo "=== smoke: ${p} ==="
    # Non-interactive: a positional prompt makes start.js run once and exit.
    set +e
    output="$(node scripts/start.js --profile-load "${p}" \
      "Reply with only the word: ok" 2>&1)"
    rc=$?
    set -e
    if echo "${output}" | grep -Eq "Extra inputs are not permitted|failover exhausted|Unsupported parameter"; then
      echo "FAIL: ${p} still emits a cross-provider 400 leak:"
      echo "${output}" | grep -E "Extra inputs are not permitted|failover exhausted|Unsupported parameter" | head -5
      smoke_failed=1
      continue
    fi
    if [[ ${rc} -ne 0 ]]; then
      if echo "${output}" | grep -q "command not found"; then
        echo "ERROR: ${p} could not run — node or a dependency is missing (rc=${rc})."
      else
        echo "WARN: ${p} exited non-zero (rc=${rc}); confirm whether the provider credentials/network are healthy."
      fi
    else
      echo "PASS: ${p} produced no cross-provider 400 leak."
    fi
  done
  exit "${smoke_failed}"
fi

if [[ "${MODE}" != "launch" ]]; then
  echo "Unknown mode '${MODE}'. Use 'launch' or 'smoke'." >&2
  exit 2
fi

PROFILES=("${ALL_PROFILES[@]}")
if [[ -n "${PROFILE_ARG}" ]]; then PROFILES=("${PROFILE_ARG}"); fi

for p in "${PROFILES[@]}"; do
  session="llxprt-${p}"
  if tmux has-session -t "${session}" 2>/dev/null; then
    echo "tmux session '${session}' already exists; attaching."
  else
    # ${p} is validated against the allow-list above; quoting keeps the
    # command unambiguous and safe.
    tmux new-session -d -s "${session}" -c "${ROOT}" \
      "node scripts/start.js --profile-load '${p}'; echo '(exited)'; bash"
    echo "Created tmux session '${session}' for profile '${p}'."
  fi
done

echo
echo "Attach with, e.g.:  tmux attach -t llxprt-opusfirst"
echo "List sessions:      tmux ls"
echo "Kill one:           tmux kill-session -t llxprt-gptfirst"
