# Extend the base pi-sandbox image with your tools.
# Lives at ~/.pi/agent/spi/Dockerfile — built automatically by spi-build
# when spi.conf has: dockerfile Dockerfile

FROM pi-sandbox

USER root

# Common utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
  jq \
  less \
  unzip \
  htop \
  && rm -rf /var/lib/apt/lists/*

# AWS CLI v2
# Requires in spi.conf:
#   mount .aws ro
#   env AWS_PROFILE
#   env AWS_REGION <your-region>
RUN ARCH="$(dpkg --print-architecture)" \
  && if [ "${ARCH}" = "arm64" ]; then ARCH="aarch64"; fi \
  && if [ "${ARCH}" = "amd64" ]; then ARCH="x86_64"; fi \
  && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip" -o /tmp/awscli.zip \
  && unzip -q /tmp/awscli.zip -d /tmp \
  && /tmp/aws/install \
  && rm -rf /tmp/aws /tmp/awscli.zip

# GitLab CLI
# Requires in spi.conf:
#   mount .config/glab-cli ro
#   arg GLAB_VERSION 1.85.2
ARG GLAB_VERSION=1.85.2
RUN ARCH="$(dpkg --print-architecture)" \
  && curl -fsSL "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_linux_${ARCH}.deb" -o /tmp/glab.deb \
  && dpkg -i /tmp/glab.deb \
  && rm /tmp/glab.deb

ARG PNPM_VERSION=9.15.4
RUN npm i -g pnpm@${PNPM_VERSION}

ENV NODE_OPTIONS="--disable-sigusr1 --max-old-space-size=8096"

USER sandbox
