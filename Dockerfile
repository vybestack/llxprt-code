FROM docker.io/library/node:24-slim

ARG SANDBOX_NAME="llxprt-code-sandbox"
ARG CLI_VERSION_ARG
ENV SANDBOX="$SANDBOX_NAME"
ENV CLI_VERSION=$CLI_VERSION_ARG

# install minimal set of packages, then clean up
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 \
  make \
  g++ \
  man-db \
  curl \
  dnsutils \
  less \
  jq \
  bc \
  git \
  unzip \
  rsync \
  ripgrep \
  procps \
  psmisc \
  lsof \
  socat \
  ca-certificates \
  openssh-client \
  git-lfs \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Install bun so --experimental-ui can run inside the sandbox.
# Use official install script and put bun on PATH for both root and node users.
ENV BUN_INSTALL=/usr/local/bun
ENV PATH=$PATH:/usr/local/bun/bin
# Pin Bun from the repo-level .bun-version so release, CI, and the image never drift.
COPY .bun-version /tmp/.bun-version
# Scope bash+pipefail to this RUN only: a failed curl in `curl | bash` must fail
# the build instead of silently succeeding (hadolint DL4006). The SHELL is reset
# right after so downstream layers keep the default /bin/sh semantics.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN BUN_VERSION="$(tr -d '[:space:]' < /tmp/.bun-version)" && \
  curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" && \
  ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun && \
  bun --version
SHELL ["/bin/sh", "-c"]

# set up npm global package folder under /usr/local/share
# give it to non-root user node, already set up in base image
RUN mkdir -p /usr/local/share/npm-global \
  && chown -R node:node /usr/local/share/npm-global
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# switch to non-root user node
USER node

# Copy packages with proper ownership
COPY --chown=node:node packages/tools/dist/vybestack-llxprt-code-tools-*.tgz /tmp/
COPY --chown=node:node packages/storage/dist/vybestack-llxprt-code-storage-*.tgz /tmp/
COPY --chown=node:node packages/auth/dist/vybestack-llxprt-code-auth-*.tgz /tmp/
COPY --chown=node:node packages/settings/dist/vybestack-llxprt-code-settings-*.tgz /tmp/
COPY --chown=node:node packages/telemetry/dist/vybestack-llxprt-code-telemetry-*.tgz /tmp/
COPY --chown=node:node packages/ide-integration/dist/vybestack-llxprt-code-ide-integration-*.tgz /tmp/
COPY --chown=node:node packages/policy/dist/vybestack-llxprt-code-policy-*.tgz /tmp/
COPY --chown=node:node packages/mcp/dist/vybestack-llxprt-code-mcp-*.tgz /tmp/
COPY --chown=node:node packages/core/dist/vybestack-llxprt-code-core-*.tgz /tmp/
COPY --chown=node:node packages/providers/dist/vybestack-llxprt-code-providers-*.tgz /tmp/
COPY --chown=node:node packages/agents/dist/vybestack-llxprt-code-agents-*.tgz /tmp/
COPY --chown=node:node packages/zed-acp/dist/vybestack-llxprt-code-zed-acp-*.tgz /tmp/

COPY --chown=node:node packages/cli/dist/vybestack-llxprt-code-*.tgz /tmp/

# Install packages globally
# Install all local tarballs in one transaction so unpublished package versions
# satisfy each other without falling back to the npm registry.
# Nightly 2026-08-18 (issue #3241) lost the whole release when a transient
# `npm error code ECONNRESET` killed this install on the QEMU-emulated arm64
# leg. The bounded retry below rides out such transient network failures;
# retries are cheap because npm's cache inside this layer already holds what
# earlier attempts fetched.
RUN export npm_config_fetch_retries=5 \
      npm_config_fetch_retry_mintimeout=1000 \
      npm_config_fetch_retry_maxtimeout=60000; \
    attempts=0; \
    until npm install -g \
      /tmp/vybestack-llxprt-code-tools-*.tgz \
      /tmp/vybestack-llxprt-code-storage-*.tgz \
      /tmp/vybestack-llxprt-code-auth-*.tgz \
      /tmp/vybestack-llxprt-code-settings-*.tgz \
      /tmp/vybestack-llxprt-code-telemetry-*.tgz \
      /tmp/vybestack-llxprt-code-ide-integration-*.tgz \
      /tmp/vybestack-llxprt-code-policy-*.tgz \
      /tmp/vybestack-llxprt-code-mcp-*.tgz \
      /tmp/vybestack-llxprt-code-core-*.tgz \
      /tmp/vybestack-llxprt-code-providers-*.tgz \
      /tmp/vybestack-llxprt-code-agents-*.tgz \
      /tmp/vybestack-llxprt-code-zed-acp-*.tgz \
      /tmp/vybestack-llxprt-code-*.tgz; do \
      attempts=$((attempts + 1)); \
      if [ "$attempts" -ge 3 ]; then \
        echo "npm install of release tarballs failed after $attempts attempts" >&2; \
        exit 1; \
      fi; \
      echo "npm install attempt $attempts failed; retrying in 15s" >&2; \
      sleep 15; \
    done && \
    npm cache clean --force && \
    rm -f /tmp/*.tgz


# Install experimental UI package into the sandbox so --experimental-ui works.
# If it's not available on the registry yet (e.g. nightlies), users can still
# mount/install it manually. This install streams straight from the registry
# and can hit the same transient network resets as the tarball install
# (issue #3241), so it gets the same bounded retry.
RUN export npm_config_fetch_retries=5 \
      npm_config_fetch_retry_mintimeout=1000 \
      npm_config_fetch_retry_maxtimeout=60000; \
    attempts=0; \
    until npm install -g @vybestack/llxprt-ui; do \
      attempts=$((attempts + 1)); \
      if [ "$attempts" -ge 3 ]; then \
        echo "npm install of @vybestack/llxprt-ui failed after $attempts attempts" >&2; \
        exit 1; \
      fi; \
      echo "npm install of @vybestack/llxprt-ui attempt $attempts failed; retrying in 15s" >&2; \
      sleep 15; \
    done && \
    npm cache clean --force

# default entrypoint when none specified
CMD ["llxprt"]
