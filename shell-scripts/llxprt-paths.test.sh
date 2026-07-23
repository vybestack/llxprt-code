#!/bin/sh
# llxprt-paths.test.sh - Behavioral tests for shell-scripts/llxprt-paths.sh
#
# Verifies the Storage override-validity contract is honored for category
# DATA/CONFIG/LOG/CACHE overrides: relative values are rejected (ignored in
# favor of env-paths defaults), absolute values are accepted.
#
# Run: sh shell-scripts/llxprt-paths.test.sh
# Requires: sh, node (for env-paths default resolution).

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="${SCRIPT_DIR}/llxprt-paths.sh"

failures=0
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

# Load the helper under test (functions only; no side effects on source).
# shellcheck source=llxprt-paths.sh
# shellcheck disable=SC1090,SC1091 # Path is dynamic ($HELPER); llxprt-paths.sh is passed as a tracked input in CI.
. "${HELPER}"

# llxprt_is_abs_override contract
echo "--- llxprt_is_abs_override ---"

# Capture the exit status into a variable before calling assert, so the
# assertion is evaluated exactly once against the command's real exit code
# (#59: avoids the fragile `cmd && assert ... || assert ... $?` pattern where
# $? in the || branch could be stale if assert ever returns non-zero).
check_exit() { # <label> <expected> <cmd...>
    _label="$1"; _exp="$2"; shift 2
    "$@"; _rc=$?
    assert "${_label}" "${_exp}" "${_rc}"
}

check_exit 'absolute accepted' 0 llxprt_is_abs_override '/etc/llxprt'
check_exit 'relative rejected' 1 llxprt_is_abs_override 'relative/path'
check_exit 'blank rejected' 1 llxprt_is_abs_override ''
check_exit 'whitespace rejected' 1 llxprt_is_abs_override '   '
check_exit 'leading-space-absolute accepted' 0 llxprt_is_abs_override ' /leading-space'

# Category resolution: relative override must be IGNORED (env-paths default),
# absolute override must be ACCEPTED. node is required for the default path.
if ! command -v node >/dev/null 2>&1; then
    echo "node not found; skipping category resolution tests"
    exit 0
fi

# Resolve the env-paths defaults and validate success. If env-paths is
# unavailable or the dynamic import fails, exit with a clear dependency-missing
# error rather than capturing empty/error output into the DEFAULT_* vars and
# producing misleading 'expected vs actual' assertion failures downstream.
DEFAULT_DATA="$(node -e "import('env-paths').then(m=>process.stdout.write(m.default('llxprt-code',{suffix:''}).data))")" || {
    echo "FATAL: failed to resolve env-paths data default" >&2
    exit 2
}
DEFAULT_LOG="$(node -e "import('env-paths').then(m=>process.stdout.write(m.default('llxprt-code',{suffix:''}).log))")" || {
    echo "FATAL: failed to resolve env-paths log default" >&2
    exit 2
}
DEFAULT_CONFIG="$(node -e "import('env-paths').then(m=>process.stdout.write(m.default('llxprt-code',{suffix:''}).config))")" || {
    echo "FATAL: failed to resolve env-paths config default" >&2
    exit 2
}
DEFAULT_CACHE="$(node -e "import('env-paths').then(m=>process.stdout.write(m.default('llxprt-code',{suffix:''}).cache))")" || {
    echo "FATAL: failed to resolve env-paths cache default" >&2
    exit 2
}

echo "--- DATA override rejection/acceptance ---"

unset LLXPRT_DATA_HOME LLXPRT_CONFIG_HOME
GOT="$(LLXPRT_DATA_HOME='relative/data' llxprt_resolve_data_dir)"
assert 'relative DATA override ignored -> env-paths default' "${DEFAULT_DATA}" "${GOT}"

GOT="$(LLXPRT_DATA_HOME='' llxprt_resolve_data_dir)"
assert 'blank DATA override ignored -> env-paths default' "${DEFAULT_DATA}" "${GOT}"

GOT="$(LLXPRT_DATA_HOME='   ' llxprt_resolve_data_dir)"
assert 'whitespace-only DATA override ignored -> env-paths default' "${DEFAULT_DATA}" "${GOT}"

GOT="$(LLXPRT_DATA_HOME='/abs/data' llxprt_resolve_data_dir)"
assert 'absolute DATA override accepted' '/abs/data' "${GOT}"

echo "--- CONFIG override rejection/acceptance ---"
GOT="$(LLXPRT_CONFIG_HOME='relative/cfg' llxprt_resolve_config_dir)"
assert 'relative CONFIG override ignored -> env-paths default' "${DEFAULT_CONFIG}" "${GOT}"

GOT="$(LLXPRT_CONFIG_HOME='   ' llxprt_resolve_config_dir)"
assert 'whitespace-only CONFIG override ignored -> env-paths default' "${DEFAULT_CONFIG}" "${GOT}"

GOT="$(LLXPRT_CONFIG_HOME='/abs/cfg' llxprt_resolve_config_dir)"
assert 'absolute CONFIG override accepted' '/abs/cfg' "${GOT}"

echo "--- LOG override rejection/acceptance ---"
GOT="$(LLXPRT_LOG_HOME='relative/log' llxprt_resolve_log_dir)"
assert 'relative LOG override ignored -> env-paths default' "${DEFAULT_LOG}" "${GOT}"

GOT="$(LLXPRT_LOG_HOME='   ' llxprt_resolve_log_dir)"
assert 'whitespace-only LOG override ignored -> env-paths default' "${DEFAULT_LOG}" "${GOT}"

GOT="$(LLXPRT_LOG_HOME='/abs/log' llxprt_resolve_log_dir)"
assert 'absolute LOG override accepted' '/abs/log' "${GOT}"

echo "--- CACHE override rejection/acceptance ---"
GOT="$(LLXPRT_CACHE_HOME='relative/cache' llxprt_resolve_cache_dir)"
assert 'relative CACHE override ignored -> env-paths default' "${DEFAULT_CACHE}" "${GOT}"

GOT="$(LLXPRT_CACHE_HOME='' llxprt_resolve_cache_dir)"
assert 'blank CACHE override ignored -> env-paths default' "${DEFAULT_CACHE}" "${GOT}"

GOT="$(LLXPRT_CACHE_HOME='/abs/cache' llxprt_resolve_cache_dir)"
assert 'absolute CACHE override accepted' '/abs/cache' "${GOT}"

echo "--- normalized (trimmed) absolute overrides (finding F) ---"
# An absolute override with leading/trailing whitespace must be TRIMMED to the
# canonical path so the emitted value matches what a caller passing a clean
# path would get.
GOT="$(LLXPRT_DATA_HOME=' /abs/data ' llxprt_resolve_data_dir)"
assert 'DATA override trimmed' '/abs/data' "${GOT}"

GOT="$(LLXPRT_CONFIG_HOME='  /abs/cfg  ' llxprt_resolve_config_dir)"
assert 'CONFIG override trimmed' '/abs/cfg' "${GOT}"

GOT="$(LLXPRT_LOG_HOME=' /abs/log ' llxprt_resolve_log_dir)"
assert 'LOG override trimmed' '/abs/log' "${GOT}"

GOT="$(LLXPRT_CACHE_HOME=' /abs/cache ' llxprt_resolve_cache_dir)"
assert 'CACHE override trimmed' '/abs/cache' "${GOT}"

# llxprt_normalized_abs_override helper: trims and echoes on success, exits 1
# for invalid (relative/blank) values.
GOT="$(llxprt_normalized_abs_override ' /abs/auth ')"
assert 'normalized_abs_override trims' '/abs/auth' "${GOT}"

llxprt_normalized_abs_override 'relative' 2>/dev/null
_rc=$?
assert 'normalized_abs_override rejects relative' 1 "${_rc}"

llxprt_normalized_abs_override '' 2>/dev/null
_rc=$?
assert 'normalized_abs_override rejects blank' 1 "${_rc}"

echo "--- compatibility CONFIG fallback for DATA ---"
# When DATA is unset but CONFIG is absolute, DATA falls back to CONFIG.
GOT="$(unset LLXPRT_DATA_HOME; LLXPRT_CONFIG_HOME='/abs/compat' llxprt_resolve_data_dir)"
assert 'compat CONFIG absolute accepted for DATA' '/abs/compat' "${GOT}"
# When CONFIG fallback is relative, it must also be ignored.
GOT="$(unset LLXPRT_DATA_HOME; LLXPRT_CONFIG_HOME='rel/compat' llxprt_resolve_data_dir)"
assert 'compat CONFIG relative ignored for DATA' "${DEFAULT_DATA}" "${GOT}"

echo "--- env-paths default resolves from arbitrary caller cwd (#6) ---"
# The env-paths default fallback must resolve regardless of the caller's cwd,
# because node resolves bare specifiers (env-paths) relative to its working
# directory. Sourcing the helper and calling the resolver from a directory
# outside the repo (e.g. /tmp) must still produce the platform default, not
# crash with ERR_MODULE_NOT_FOUND (#6: resolution must work from arbitrary
# caller cwd; resolve relative to the helper/repo, not the caller). The
# caller records its script dir via llxprt_paths_init so the resolver can find
# the repo-located env-paths from any cwd.
_OUTSIDE_DIR="$(mktemp -d)"
# Invoke a fresh sh that sources the helper from an outside cwd and calls the
# resolver with all overrides unset so the env-paths default path is taken.
# The caller records the helper's directory via llxprt_paths_init (the
# documented contract for outside-cwd resolution, #6).
# NOTE: _rc is global; reset it before capture so a prior test's value is not
# retained when the `|| _rc=$?` branch does not fire (command succeeded).
_rc=0
GOT="$(
    cd "${_OUTSIDE_DIR}" || exit 1
      unset LLXPRT_DATA_HOME LLXPRT_CONFIG_HOME LLXPRT_LOG_HOME LLXPRT_CACHE_HOME
    # shellcheck source=llxprt-paths.sh
    # shellcheck disable=SC1091 # Path is dynamic ($HELPER); followed via source directive above for top-level source.
    . "${HELPER}"
    llxprt_paths_init "${SCRIPT_DIR}"
    llxprt_resolve_data_dir
)" || _rc=$?
assert 'env-paths default resolves from outside cwd via init (exit 0)' 0 "${_rc}"
assert 'env-paths default resolves from outside cwd via init (value)' "${DEFAULT_DATA}" "${GOT}"
rm -rf "${_OUTSIDE_DIR}"

if [ "${failures}" -gt 0 ]; then
    echo ""
    echo "${failures} assertion(s) FAILED"
    exit 1
fi
echo ""
echo "All llxprt-paths behavioral tests PASSED"
exit 0
