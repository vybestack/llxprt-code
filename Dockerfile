FROM docker.io/library/node:20-slim

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
  gh \
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
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.5" && \
  ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun && \
  bun --version

# set up npm global package folder under /usr/local/share
# give it to non-root user node, already set up in base image
RUN mkdir -p /usr/local/share/npm-global \
  && chown -R node:node /usr/local/share/npm-global
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# switch to non-root user node
USER node

# Copy packages with proper ownership
COPY --chown=node:node packages/core/dist/vybestack-llxprt-code-core-*.tgz /tmp/
COPY --chown=node:node packages/cli/dist/vybestack-llxprt-code-*.tgz /tmp/

# Install packages globally
# npm install -g with local tarballs will install dependencies from npm registry
RUN npm install -g /tmp/vybestack-llxprt-code-core-*.tgz && \
    npm install -g /tmp/vybestack-llxprt-code-*.tgz && \
    npm cache clean --force && \
    rm -f /tmp/*.tgz

# Install experimental UI package into the sandbox so --experimental-ui works.
# If it's not available on the registry yet (e.g. nightlies), users can still
# mount/install it manually.
RUN npm install -g @vybestack/llxprt-ui && npm cache clean --force

# default entrypoint when none specified
CMD ["llxprt"]
