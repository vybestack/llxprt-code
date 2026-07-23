#!/bin/sh
# llxprt-paths.sh - Reusable POSIX resolver for canonical LLxprt category dirs.
#
# Centralizes the Storage override-validity contract for shell scripts:
# a category override (LLXPRT_<CATEGORY>_HOME) or the compatibility
# LLXPRT_CONFIG_HOME override is honored ONLY when it is a non-empty absolute
# path. Relative, blank, and whitespace-only values are ignored in favor of
# the env-paths default, exactly matching packages/storage Storage behavior.
#
# Sourcing (POSIX sh; no bashisms):
#   _SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
#   . ./llxprt-paths.sh
#   llxprt_paths_init "$_SCRIPT_DIR"  # record caller dir so env-paths default
#                                     # resolves from any cwd (issue #2606 #6)
#   llxprt_resolve_config_dir   # prints canonical config dir
#   llxprt_resolve_data_dir     # prints canonical data dir
#   llxprt_resolve_log_dir      # prints canonical log dir
#   llxprt_resolve_cache_dir    # prints canonical cache dir
#
# Optional per-script explicit override env vars (e.g. CODEX_AUTH_DIR,
# LLXPRT_DEBUG_DIR) are NOT handled here; each script validates its own
# explicit override against the same contract via llxprt_is_abs_override.

# When sourced, POSIX sh does not expose the helper's own path ($0 is the
# caller's script). Callers SHOULD invoke `llxprt_paths_init "$_SCRIPT_DIR"`
# after sourcing so the env-paths default can be resolved relative to the
# repo that owns this helper (issue #2606 finding #6). When not initialized,
# the resolver falls back to walking up from $0 then $PWD.
_LLXPRT_PATHS_INIT_DIR=''

# Record the caller's script directory so the env-paths default can be
# resolved from any caller cwd (#6). Call once after sourcing:
#   . "$_SCRIPT_DIR/llxprt-paths.sh"
#   llxprt_paths_init "$_SCRIPT_DIR"
# $1 - absolute or relative directory of the calling script (usually
#      _SCRIPT_DIR). Optional; without it the resolver uses $0/PWD fallbacks.
llxprt_paths_init() {
    _LLXPRT_PATHS_INIT_DIR="${1-}"
}

# Returns 0 (true) if $1 is a non-empty absolute path, 1 otherwise.
# Mirrors Storage.isNonEmptyAbsoluteOverride(): reject blank, whitespace-only,
# and relative values.
llxprt_is_abs_override() {
    _llxprt_val="${1-}"
    # Trim leading/trailing whitespace without bashisms.
    _llxprt_val="$(printf '%s' "${_llxprt_val}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [ -n "${_llxprt_val}" ] || return 1
    # POSIX absolute-path test: leading '/' (Unix). Windows absolute paths are
    # not supported by these Unix-oriented scripts.
    case "${_llxprt_val}" in
        /*) return 0 ;;
        *) return 1 ;;
    esac
}

# Normalize (trim) an absolute override value and echo it, or return 1 when
# the value is not a valid absolute override. Used by scripts that need the
# TRIMMED value for both use AND export (issue #2606 finding F: emit/use
# normalized values consistently for CODEX_AUTH_DIR, LLXPRT_DEBUG_DIR, and
# category roots).
llxprt_normalized_abs_override() {
    _llxprt_raw="${1-}"
    if ! llxprt_is_abs_override "${_llxprt_raw}"; then
        return 1
    fi
    _llxprt_raw="$(printf '%s' "${_llxprt_raw}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    printf '%s' "${_llxprt_raw}"
}

# Print a category dir, honoring $1 (primary env), $2 (compat env fallback),
# then the env-paths default for $3 (category key: config|data|cache|log).
#
# Absolute overrides are TRIMMED before use so a value like ' /abs/path '
# produces the same canonical path as '/abs/path' (issue #2606 finding F:
# normalize absolute overrides and emit/use normalized values consistently).
llxprt_resolve_category() {
    _llxprt_primary="${1-}"
    _llxprt_compat="${2-}"
    _llxprt_cat="${3-}"

    # Validate indirect-variable names against a safe charset to prevent
    # shell injection via eval. Only [A-Za-z_][A-Za-z_0-9]* identifiers are
    # allowed.
    case "${_llxprt_primary}" in
        ''|*[!A-Za-z_0-9]*) return 1 ;;
        *) ;;
    esac

    # Validate the category against an allowlist before interpolation into
    # the node -e command to prevent JavaScript injection.
    case "${_llxprt_cat}" in
        config|data|cache|log) ;;
        *) return 1 ;;
    esac

    if _llxprt_val="$(eval "printf '%s' \"\${${_llxprt_primary}-}\"")" && llxprt_is_abs_override "${_llxprt_val}"; then
        _llxprt_val="$(printf '%s' "${_llxprt_val}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
        printf '%s' "${_llxprt_val}"
        return 0
    fi
    if [ -n "${_llxprt_compat}" ]; then
        case "${_llxprt_compat}" in
            ''|*[!A-Za-z_0-9]*) ;;
            *)
                if _llxprt_val="$(eval "printf '%s' \"\${${_llxprt_compat}-}\"")" && llxprt_is_abs_override "${_llxprt_val}"; then
                    _llxprt_val="$(printf '%s' "${_llxprt_val}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
                    printf '%s' "${_llxprt_val}"
                    return 0
                fi
                ;;
        esac
    fi
    # env-paths is an ESM-only module. node resolves bare specifiers relative
    # to its working directory, so import('env-paths') only succeeds when cwd
    # is inside the repo whose node_modules contains it. Resolve the directory
    # that owns env-paths relative to THIS helper's location (not the caller's
    # cwd) and run node there so the default resolves from any caller cwd
    # (issue #2606 finding #6).
    _llxprt_repo_dir="$(_llxprt_resolve_env_paths_root)" || return 1
    (
        cd "${_llxprt_repo_dir}" || exit 1
        node -e "import('env-paths').then(m=>process.stdout.write(m.default('llxprt-code',{suffix:''}).${_llxprt_cat}))"
    )
}

# Resolve the directory from which `import('env-paths')` succeeds. Tries, in
# order: the caller-provided init dir (llxprt_paths_init), $0 (the caller
# script, usually alongside this helper), then $PWD. Walks up each starting
# point until node_modules/env-paths is found. Returns 0 and prints the
# directory on stdout; returns 1 if none is found. This makes the env-paths
# default work regardless of the caller's cwd (#6).
_llxprt_resolve_env_paths_root() {
    # Candidate starting directories (absolute). Prefer the explicit init dir
    # recorded by llxprt_paths_init, then the caller's $0, then $PWD.
    _llxprt_cand_init=''
    if [ -n "${_LLXPRT_PATHS_INIT_DIR}" ]; then
        case "${_LLXPRT_PATHS_INIT_DIR}" in
            /*) _llxprt_cand_init="${_LLXPRT_PATHS_INIT_DIR}" ;;
            *)  _llxprt_cand_init="$(pwd)/${_LLXPRT_PATHS_INIT_DIR}" ;;
        esac
    fi
    _llxprt_cand_zero=''
    _llxprt_self="${0-}"
    if [ -n "${_llxprt_self}" ]; then
        case "${_llxprt_self}" in
            /*) _llxprt_cand_zero="$(dirname "${_llxprt_self}")" ;;
            *)  _llxprt_cand_zero="$(dirname "$(pwd)/${_llxprt_self}")" ;;
        esac
    fi
    _llxprt_cand_pwd="$(pwd)"
    # Walk up each candidate until node_modules/env-paths is found.
    for _llxprt_start in "${_llxprt_cand_init}" "${_llxprt_cand_zero}" "${_llxprt_cand_pwd}"; do
        [ -n "${_llxprt_start}" ] || continue
        _llxprt_d="${_llxprt_start}"
        while [ "${_llxprt_d}" != "" ] && [ "${_llxprt_d}" != "/" ]; do
            if [ -d "${_llxprt_d}/node_modules/env-paths" ]; then
                printf '%s' "${_llxprt_d}"
                return 0
            fi
            _llxprt_d="$(dirname "${_llxprt_d}")"
        done
    done
    return 1
}

llxprt_resolve_config_dir() {
    llxprt_resolve_category 'LLXPRT_CONFIG_HOME' '' 'config'
}

llxprt_resolve_data_dir() {
    llxprt_resolve_category 'LLXPRT_DATA_HOME' 'LLXPRT_CONFIG_HOME' 'data'
}

llxprt_resolve_cache_dir() {
    llxprt_resolve_category 'LLXPRT_CACHE_HOME' 'LLXPRT_CONFIG_HOME' 'cache'
}

llxprt_resolve_log_dir() {
    llxprt_resolve_category 'LLXPRT_LOG_HOME' 'LLXPRT_CONFIG_HOME' 'log'
}
