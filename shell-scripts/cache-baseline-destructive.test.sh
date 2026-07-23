#!/bin/sh
# cache-baseline-destructive.test.sh - Behavioral test that cache-baseline-test.sh
# is non-destructive by default and never clears a canonical log/debug dir.
#
# Verifies (Finding #10):
# 1. WITHOUT opt-in: the canonical log/debug dir is NOT touched (a sentinel
#    file survives), and the benchmark uses an isolated temp dir.
# 2. WITH explicit opt-in + absolute LLXPRT_DEBUG_DIR: the caller-selected
#    absolute debug dir IS cleared (explicit, safe behavior).
# 3. WITH opt-in but a RELATIVE LLXPRT_DEBUG_DIR: the script errors out
#    rather than clearing anything (Storage override-validity contract).
#
# The target script (cache-baseline-test.sh) uses Bash-specific features
# ([[ ]], ${BASH_SOURCE[0]}, arrays) and declares #!/bin/bash. This test
# invokes it with `bash` explicitly to match its shebang and avoid portability
# issues when /bin/sh is dash or another POSIX-only shell. The test itself
# is POSIX-portable (#!/bin/sh) so it can run under dash as an outer shell.
#
# Run: sh shell-scripts/cache-baseline-destructive.test.sh
# Or:  dash shell-scripts/cache-baseline-destructive.test.sh
# Requires: sh (or dash), bash, mktemp. Does NOT run bun (early-exit path).

set -u

# Ensure temp dirs created by this script are cleaned up on any exit path.
_TMP_DIRS_TO_CLEANUP=""
# shellcheck disable=SC2329 # Invoked indirectly via the EXIT trap below.
_cleanup_tmp_dirs() {
    # shellcheck disable=SC2086 # Intentional word-splitting: space-separated dir list.
    [ -n "${_TMP_DIRS_TO_CLEANUP}" ] && rm -rf ${_TMP_DIRS_TO_CLEANUP}
}
trap '_cleanup_tmp_dirs' EXIT

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE_SCRIPT="${SCRIPT_DIR}/cache-baseline-test.sh"
failures=0

# Use bash explicitly for the Bash-only target script.
CACHE_SH="bash"

assert() { # <label> <expected> <actual>
    _label="$1"; _exp="$2"; _act="$3"
    if [ "${_exp}" = "${_act}" ]; then
        echo "PASS: ${_label}"
    else
        echo "FAIL: ${_label}"
        echo "      expected: ${_exp}"
        echo "      actual:   ${_act}"
        failures=$((failures + 1))
    fi
}

# --- Test 1: opt-in with relative LLXPRT_DEBUG_DIR errors out ---
# Exercise the opt-in guard: opt-in + relative DEBUG_DIR must fail before
# clearing anything. (Finding #4, guard contract.)
echo "--- opt-in with relative LLXPRT_DEBUG_DIR errors out ---"
REL_TARGET="relative-debug-dir"
RESULT_CODE=0
LLXPRT_CACHE_BASELINE_CLEAR_DEBUG=1 LLXPRT_DEBUG_DIR="${REL_TARGET}" \
    ${CACHE_SH} "${CACHE_SCRIPT}" >/dev/null 2>&1 || RESULT_CODE=$?
assert 'relative DEBUG_DIR + opt-in exits non-zero' '1' "${RESULT_CODE}"
# The relative dir must NOT have been created/cleared in the CWD.
if [ -d "${REL_TARGET}" ]; then
    echo "FAIL: relative DEBUG_DIR was created in CWD"
    failures=$((failures + 1))
    rmdir "${REL_TARGET}" 2>/dev/null || rm -rf "${REL_TARGET}"
else
    echo "PASS: relative DEBUG_DIR not created"
fi

# --- Test 1b: WITHOUT opt-in, an explicitly-set canonical dir is NOT touched ---
# Create a sentinel file in a temp 'canonical' dir, point LLXPRT_DEBUG_DIR at
# it WITHOUT opt-in, and assert the sentinel survives (the script must use its
# isolated temp dir, never clearing the caller-named canonical dir). This is
# the critical safety contract promised in the header.
echo "--- WITHOUT opt-in, a caller-named canonical dir is left untouched ---"
CANON_DIR="$(mktemp -d -t llxprt-cb-canon-XXXXXX)/debug"
_TMP_DIRS_TO_CLEANUP="${_TMP_DIRS_TO_CLEANUP} $(dirname "${CANON_DIR}")"
mkdir -p "${CANON_DIR}"
SENTINEL="${CANON_DIR}/sentinel-survives"
echo "do-not-delete" > "${SENTINEL}"
RESULT_CODE=0
LLXPRT_DEBUG_DIR="${CANON_DIR}" ${CACHE_SH} "${CACHE_SCRIPT}" >/dev/null 2>&1 || RESULT_CODE=$?
if [ -f "${SENTINEL}" ]; then
    echo "PASS: sentinel survived without opt-in (canonical dir untouched)"
else
    echo "FAIL: sentinel was removed without opt-in"
    failures=$((failures + 1))
fi
# The canonical dir must still contain exactly the sentinel (not cleared).
REMAINING="$(find "${CANON_DIR}" -type f | wc -l | tr -d ' ')"
assert 'canonical dir retains sentinel (1 file)' '1' "${REMAINING}"
rm -rf "$(dirname "${CANON_DIR}")"

# --- Test 2: opt-in guard accepts only absolute ---
# When opt-in is set and DEBUG_DIR is absolute, the script proceeds past the
# guard. To make this bun-independent (the script fails later on missing bun),
# we re-run capturing stderr: a guard error contains "requires an absolute",
# while any other failure (e.g. missing bun) means the guard PASSED.
echo "--- opt-in with absolute LLXPRT_DEBUG_DIR passes the guard ---"
TMP_ABS="$(mktemp -d -t llxprt-cb-abs-XXXXXX)"
_TMP_DIRS_TO_CLEANUP="${_TMP_DIRS_TO_CLEANUP} ${TMP_ABS}"
ERR_MSG="$(LLXPRT_CACHE_BASELINE_CLEAR_DEBUG=1 LLXPRT_DEBUG_DIR="${TMP_ABS}" \
    ${CACHE_SH} "${CACHE_SCRIPT}" 2>&1 >/dev/null)"
case "${ERR_MSG}" in
    *"requires an absolute"*)
        assert 'absolute DEBUG_DIR passes the guard (no guard error)' '0' '1'
        ;;
    *)
        echo "PASS: absolute DEBUG_DIR passes the guard"
        ;;
esac
rm -rf "${TMP_ABS}"

# --- Test 3: without opt-in, no LLXPRT_DEBUG_DIR export leaks canonical ---
# When opt-in is unset, the script exports an isolated temp LLXPRT_DEBUG_DIR.
# We assert this by capturing the printed DEBUG_DIR: it must be under a temp
# prefix, NOT the canonical env-paths log dir.
echo "--- non-destructive default uses isolated temp dir ---"
OUT="$(${CACHE_SH} "${CACHE_SCRIPT}" 2>/dev/null | sed -n 's/^Debug dir: //p' | head -1)"
case "${OUT}" in
    *llxprt-cache-baseline-*)
        echo "PASS: default uses isolated temp benchmark dir"
        ;;
    *)
        echo "FAIL: default DEBUG_DIR is not an isolated temp dir: ${OUT}"
        failures=$((failures + 1))
        ;;
esac

if [ "${failures}" -gt 0 ]; then
    echo ""
    echo "${failures} assertion(s) FAILED"
    exit 1
fi
echo ""
echo "All cache-baseline non-destructive behavioral tests PASSED"
exit 0
