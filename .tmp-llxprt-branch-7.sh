#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="${0##*/}"

BRANCH_DIR="${LLXPRT_BRANCH_DIR:-$HOME/projects/llxprt/branch-2/llxprt-code}"
RUN_DIR="${LLXPRT_RUN_DIR:-}"

SANDBOX_ENGINE="${LLXPRT_SANDBOX_ENGINE:-podman}"
SANDBOX_IMAGE_REPO="${LLXPRT_SANDBOX_IMAGE_REPO:-ghcr.io/vybestack/llxprt-code/sandbox}"
SANDBOX_IMAGE_TAG="${LLXPRT_LOCAL_SANDBOX_TAG:-local-branch-7}"
SANDBOX_IMAGE="${SANDBOX_IMAGE_REPO}:${SANDBOX_IMAGE_TAG}"

DEFAULT_SANDBOX_FLAGS="--cpus=2 --memory=12g --pids-limit=256"
SANDBOX_FLAGS_VALUE="${SANDBOX_FLAGS:-$DEFAULT_SANDBOX_FLAGS}"

usage() {
  cat <<'USAGE'
Usage: llxprt-branch-7.sh [RUN_DIR] [-- <llxprt args...>]

Build branch code, build branch sandbox image, link local CLI globally, then
launch interactive llxprt in RUN_DIR using the local sandbox image.

Examples:
  llxprt-branch-7.sh ~/projects/another-repo
  llxprt-branch-7.sh ~/projects/another-repo -- --debug

Environment overrides:
  LLXPRT_BRANCH_DIR
  LLXPRT_RUN_DIR
  LLXPRT_SANDBOX_ENGINE
  LLXPRT_SANDBOX_IMAGE_REPO
  LLXPRT_LOCAL_SANDBOX_TAG
  SANDBOX_FLAGS
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$RUN_DIR" && "${1:-}" != "" && "${1:-}" != "--" ]]; then
  RUN_DIR="$1"
  shift
fi
if [[ "${1:-}" == "--" ]]; then
  shift
fi
RUN_DIR="${RUN_DIR:-$PWD}"

if [[ ! -d "$BRANCH_DIR" ]]; then
  echo "Missing branch directory: $BRANCH_DIR" >&2
  exit 1
fi
if [[ ! -d "$RUN_DIR" ]]; then
  echo "Missing run directory: $RUN_DIR" >&2
  exit 1
fi
if [[ "$RUN_DIR" == "$BRANCH_DIR" ]]; then
  echo "Refusing to run in branch directory (turducken guard): $RUN_DIR" >&2
  echo "Pass a different RUN_DIR or set LLXPRT_RUN_DIR." >&2
  exit 1
fi

cd "$BRANCH_DIR"

echo "[1/4] Building workspace in $BRANCH_DIR" >&2
npm run build

echo "[2/4] Building sandbox image ${SANDBOX_IMAGE} (engine=${SANDBOX_ENGINE})" >&2
LLXPRT_SANDBOX="$SANDBOX_ENGINE" \
LLXPRT_SANDBOX_IMAGE_TAG="$SANDBOX_IMAGE_TAG" \
npm run build:sandbox

echo "[3/4] Linking local CLI globally from packages/cli" >&2
cd "$BRANCH_DIR/packages/cli"
npm link

echo "llxprt on PATH after link:" >&2
which llxprt >&2 || true

echo "[4/4] Launching interactive llxprt in $RUN_DIR" >&2
echo "      Sandbox image: $SANDBOX_IMAGE" >&2
echo "      Sandbox flags: $SANDBOX_FLAGS_VALUE" >&2

cd "$RUN_DIR"
LLXPRT_SANDBOX="$SANDBOX_ENGINE" \
LLXPRT_SANDBOX_IMAGE="$SANDBOX_IMAGE" \
SANDBOX_FLAGS="$SANDBOX_FLAGS_VALUE" \
exec llxprt --sandbox-image "$SANDBOX_IMAGE" "$@"
