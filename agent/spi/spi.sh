#!/usr/bin/env bash
# spi — sandboxed pi. Run pi inside a Docker container.
#
# Source this file in your shell rc (~/.zshrc, ~/.bashrc):
#   source /path/to/pi/container/spi.sh
#
# Usage:
#   spi            — start pi in a container scoped to the current directory
#   spi-build      — build (or rebuild) the Docker image from spi.conf
#   spi-clean      — remove the sandbox container for the current directory
#   spi-clean --all — remove all sandbox containers

# Do not use set -e in a sourced script; it affects the parent shell.

# SC2312: We use `cmd | grep -q` pipelines where only the grep exit code
# matters. Capturing the left side into a variable first adds noise.
# shellcheck disable=SC2312

: "${SPI_IMAGE:=pi-sandbox}"
readonly SPI_PREFIX="spi-"
readonly SPI_CONFIG="${HOME}/.pi/agent/spi/spi.conf"

# Override SPI_IMAGE from config if set
if [[ -f "${SPI_CONFIG}" ]]; then
  _spi_image="$(grep -m1 "^image " "${SPI_CONFIG}" 2>/dev/null | awk '{print $2}')" || _spi_image=""
  [[ -n "${_spi_image}" ]] && SPI_IMAGE="${_spi_image}"
  unset _spi_image
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_spi_hash() {
  local cwd
  cwd="$(pwd)" || return
  if command -v md5 &>/dev/null; then
    printf '%s' "${cwd}" | md5 -q | cut -c1-8
  else
    printf '%s' "${cwd}" | md5sum | cut -c1-8
  fi
}

# Read config and append mount/env flags to the caller's run_args array.
# Contract: caller must declare `local -a run_args` before calling.
_spi_apply_config() {
  [[ -f "${SPI_CONFIG}" ]] || return 0

  local line w1 w2 w3 mode host_path container_path val
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%%#*}"
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*$ ]] && continue

    IFS=' ' read -r w1 w2 w3 <<< "${line}"

    case "${w1}" in
      mount)
        [[ -z "${w2}" ]] && continue
        mode="${w3:-ro}"
        host_path="${HOME}/${w2}"
        container_path="/home/sandbox/${w2}"
        [[ -e "${host_path}" ]] && run_args+=(-v "${host_path}:${container_path}:${mode}")
        ;;
      env)
        [[ -z "${w2}" ]] && continue
        val="$(printenv "${w2}" 2>/dev/null)" || true
        if [[ -n "${val}" ]]; then
          run_args+=(-e "${w2}=${val}")
        elif [[ -n "${w3}" ]]; then
          run_args+=(-e "${w2}=${w3}")
        fi
        ;;
      version|dockerfile|image|arg)
        # Build-time directives, handled by spi-build.
        ;;
      *)
        echo "spi: unknown directive '${w1}' in ${SPI_CONFIG}" >&2
        ;;
    esac
  done < "${SPI_CONFIG}"
}

# Detect and mount the SSH agent socket into the container.
# Contract: caller must declare `local -a run_args` before calling.
_spi_ssh_mount() {
  local os
  os="$(uname)" || true

  if [[ "${os}" == "Darwin" ]]; then
    if docker info 2>/dev/null | grep -q "Docker Desktop"; then
      run_args+=(-v /run/host-services/ssh-auth.sock:/tmp/ssh.sock -e SSH_AUTH_SOCK=/tmp/ssh.sock)
      return
    fi

    if command -v colima &>/dev/null; then
      local colima_sock
      colima_sock="$(colima ssh -- printenv SSH_AUTH_SOCK 2>/dev/null)" || true
      if [[ -n "${colima_sock}" ]]; then
        run_args+=(-v "${colima_sock}:/tmp/ssh.sock" -e SSH_AUTH_SOCK=/tmp/ssh.sock)
        return
      fi
    fi
  fi

  if [[ -n "${SSH_AUTH_SOCK:-}" && -S "${SSH_AUTH_SOCK:-}" ]]; then
    run_args+=(-v "${SSH_AUTH_SOCK}:/tmp/ssh.sock" -e SSH_AUTH_SOCK=/tmp/ssh.sock)
  fi
}

# ---------------------------------------------------------------------------
# Public commands
# ---------------------------------------------------------------------------

# Build the Docker image(s) using version, dockerfile, and args from spi.conf.
spi-build() {
  if [[ ! -f "${SPI_CONFIG}" ]]; then
    echo "Error: no config at ${SPI_CONFIG}" >&2
    return 1
  fi

  local config_dir version dockerfile
  config_dir="$(dirname "${SPI_CONFIG}")"
  version="$(grep -m1 "^version " "${SPI_CONFIG}" | awk '{print $2}')" || version=""
  dockerfile="$(grep -m1 "^dockerfile " "${SPI_CONFIG}" | awk '{print $2}')" || dockerfile=""

  if [[ ! -f "${config_dir}/Dockerfile.base" ]]; then
    echo "Error: ${config_dir}/Dockerfile.base not found. Run setup again." >&2
    return 1
  fi

  # Base image only needs PI_VERSION
  local -a base_build_args=(docker build)
  [[ -n "${version}" ]] && base_build_args+=(--build-arg "PI_VERSION=${version}")

  echo "Building pi-sandbox${version:+ (pi ${version})}..."
  if ! "${base_build_args[@]}" -t pi-sandbox -f "${config_dir}/Dockerfile.base" "${config_dir}"; then
    echo "Error: base image build failed." >&2
    return 1
  fi

  # Extended image gets PI_VERSION + all arg directives from config
  if [[ -n "${dockerfile}" ]]; then
    local -a ext_build_args=(docker build)
    [[ -n "${version}" ]] && ext_build_args+=(--build-arg "PI_VERSION=${version}")

    local line w1 w2 w3
    while IFS= read -r line || [[ -n "${line}" ]]; do
      line="${line%%#*}"
      [[ -z "${line}" || "${line}" =~ ^[[:space:]]*$ ]] && continue
      IFS=' ' read -r w1 w2 w3 <<< "${line}"
      [[ "${w1}" == "arg" && -n "${w2}" && -n "${w3}" ]] && ext_build_args+=(--build-arg "${w2}=${w3}")
    done < "${SPI_CONFIG}"

    echo "Building ${SPI_IMAGE}..."
    if ! "${ext_build_args[@]}" -t "${SPI_IMAGE}" -f "${config_dir}/${dockerfile}" "${config_dir}"; then
      echo "Error: extended image build failed." >&2
      return 1
    fi
  fi
}

spi() {
  if ! command -v docker &>/dev/null; then
    echo "Error: docker not found in PATH." >&2
    return 1
  fi

  if ! docker image inspect "${SPI_IMAGE}" >/dev/null 2>&1; then
    echo "Error: Docker image '${SPI_IMAGE}' not found. Run spi-build first." >&2
    return 1
  fi

  local hash name cwd
  hash="$(_spi_hash)"
  name="${SPI_PREFIX}${hash}"
  cwd="$(pwd)" || return

  # Clean stale stopped container
  if docker ps -aq -f name="${name}" -f status=exited | grep -q .; then
    docker rm "${name}" >/dev/null 2>&1
  fi

  # Start container if not running
  if ! docker ps -q -f name="${name}" | grep -q .; then
    echo "Starting sandbox ${name}..."

    [[ ! -d "${HOME}/.pi/agent" ]] && mkdir -p "${HOME}/.pi/agent"

    local -a run_args=(
      docker run -d --name "${name}"
      --cap-drop ALL
      --security-opt no-new-privileges
      --pids-limit 512
      -e HOME=/home/sandbox
      -v "${cwd}:${cwd}"
      -v "${HOME}/.pi/agent:/home/sandbox/.pi/agent"
    )

    _spi_apply_config
    _spi_ssh_mount

    run_args+=(-w "${cwd}" "${SPI_IMAGE}" sleep infinity)

    if ! "${run_args[@]}" >/dev/null; then
      echo "Error: Failed to start sandbox." >&2
      return 1
    fi
  fi

  docker exec -it "${name}" pi "$@"
}

spi-clean() {
  if [[ "${1:-}" == "--all" ]]; then
    local ids
    ids="$(docker ps -aq -f name="${SPI_PREFIX}")"
    if [[ -z "${ids}" ]]; then
      echo "No sandbox containers found."
      return
    fi
    # Remove each container individually so one failure doesn't block the rest.
    while IFS= read -r id; do
      docker rm -f "${id}" >/dev/null 2>&1 || docker stop "${id}" >/dev/null 2>&1 || true
    done <<< "${ids}"
    echo "Removed all sandbox containers."
  else
    local hash name
    hash="$(_spi_hash)"
    name="${SPI_PREFIX}${hash}"
    if docker rm -f "${name}" >/dev/null 2>&1; then
      echo "Removed ${name}."
    else
      echo "No sandbox container for this directory."
    fi
  fi
}
