#!/usr/bin/env bash
set -euo pipefail

# This script creates an alias for the Gemini CLI

# Determine the project directory
PROJECT_DIR=$(cd "$(dirname "$0")/.." && pwd)
if ! command -v bun >/dev/null 2>&1; then
    echo "Error: 'bun' was not found on your PATH. Please install Bun first: https://bun.sh" >&2
    exit 1
fi

ALIAS_COMMAND="alias llxprt='bun \"${PROJECT_DIR}/scripts/start.ts\"'"

# Detect shell and set config file path
if [[ "${SHELL}" == *"/bash" ]]; then
    CONFIG_FILE="${HOME}/.bashrc"
elif [[ "${SHELL}" == *"/zsh" ]]; then
    CONFIG_FILE="${HOME}/.zshrc"
else
    echo "Unsupported shell. Only bash and zsh are supported."
    exit 1
fi

echo "This script will add the following alias to your shell configuration file (${CONFIG_FILE}):"
echo "  ${ALIAS_COMMAND}"
echo ""

# Check if the alias already exists
if [[ -f "${CONFIG_FILE}" ]] && grep -Eq '^[[:space:]]*alias[[:space:]]+llxprt=' "${CONFIG_FILE}"; then
    if grep -Eq '^[[:space:]]*alias[[:space:]]+llxprt=.*start\.js' "${CONFIG_FILE}"; then
        echo "A stale 'llxprt' alias that points to the former JavaScript entrypoint was found in ${CONFIG_FILE}."
        read -p "Replace it with the Bun-backed alias? (y/n) " -n 1 -r || REPLY=""
        echo ""
        if [[ ! "${REPLY}" =~ ^[Yy]$ ]]; then
            echo "Aborted. No changes were made."
            exit 0
        fi

        BACKUP_FILE="${CONFIG_FILE}.llxprt-backup.$(date +%Y%m%d%H%M%S)"
        cp -p "${CONFIG_FILE}" "${BACKUP_FILE}" || { echo "Error: failed to back up ${CONFIG_FILE}." >&2; exit 1; }
        ORIGINAL_PERMS=$(stat -c '%a' "${CONFIG_FILE}" 2>/dev/null || stat -f '%Lp' "${CONFIG_FILE}" 2>/dev/null)
        if [[ -z "${ORIGINAL_PERMS}" ]]; then
            echo "Error: could not read permissions of ${CONFIG_FILE}. Aborting to avoid loosening file permissions." >&2
            exit 1
        fi
        TMP_CONFIG=$(mktemp "${CONFIG_FILE}.tmp.XXXXXX") || { echo "Error: failed to create temp file." >&2; exit 1; }
        trap 'rm -f "${TMP_CONFIG}"' EXIT
        if ! awk -v alias_line="${ALIAS_COMMAND}" '
            /^[[:space:]]*alias[[:space:]]+llxprt=.*start\.js/ {
                if (!replaced) { print alias_line; replaced = 1 }
                else { printf "Removed duplicate stale llxprt alias: %s\n", $0 > "/dev/stderr" }
                next
            }
            { print }
        ' "${CONFIG_FILE}" > "${TMP_CONFIG}"; then
            echo "Error: failed to process ${CONFIG_FILE} — original file unchanged." >&2
            exit 1
        fi

        if [[ ! -s "${TMP_CONFIG}" ]] || ! grep -Eq '^[[:space:]]*alias[[:space:]]+llxprt=.*start\.ts' "${TMP_CONFIG}"; then
            echo "Error: failed to process ${CONFIG_FILE} — original file unchanged." >&2
            exit 1
        fi
        chmod "${ORIGINAL_PERMS}" "${TMP_CONFIG}" || { rm -f "${TMP_CONFIG}"; echo "Error: failed to set permissions on temp file." >&2; exit 1; }

        mv -f "${TMP_CONFIG}" "${CONFIG_FILE}" || { rm -f "${TMP_CONFIG}"; echo "Error: failed to update ${CONFIG_FILE}." >&2; exit 1; }
        trap - EXIT
        echo "Updated stale 'llxprt' alias in ${CONFIG_FILE}."
        echo "Backup saved to ${BACKUP_FILE}."
        echo "Please run 'source ${CONFIG_FILE}' or open a new terminal to use the 'llxprt' command."
        exit 0
    fi
    echo "A 'llxprt' alias already exists in ${CONFIG_FILE}. No changes were made."
    echo "If this alias is outdated, remove or update it before re-running this script."
    exit 0
fi

REPLY=""
if ! read -p "Do you want to proceed? (y/n) " -n 1 -r; then
    REPLY=""
fi
echo ""
if [[ "${REPLY}" =~ ^[Yy]$ ]]; then
    if [[ -f "${CONFIG_FILE}" ]]; then
        last_byte_hex=$(tail -c 1 "${CONFIG_FILE}" 2>/dev/null | od -An -tx1 | tr -d '[:space:]' || true)
        if [[ "${last_byte_hex}" != "0a" ]]; then
            printf '\n' >> "${CONFIG_FILE}"
        fi
    fi
    echo "${ALIAS_COMMAND}" >> "${CONFIG_FILE}"
    echo ""
    echo "Alias added to ${CONFIG_FILE}."
    echo "Please run 'source ${CONFIG_FILE}' or open a new terminal to use the 'llxprt' command."
else
    echo "Aborted. No changes were made."
fi
