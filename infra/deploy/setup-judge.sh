#!/usr/bin/env bash
# Run on the judge VM from /opt/ipp-src:   infra/deploy/setup-judge.sh 'redis://judge:<password>@<app ip>:6379'
# Installs Docker, gVisor and Rust, builds the sandbox images and the judge, verifies the sandbox
# UNDER gVisor (the test suite has only ever run under runc before this), and installs the service.
set -euo pipefail
REDIS_URL=${1:?usage: setup-judge.sh <redis url for the judge user>}
cd "$(dirname "$0")/../.."

sudo apt-get update
sudo apt-get install -y docker.io build-essential pkg-config curl ca-certificates gnupg
sudo usermod -aG docker "$USER"

# gVisor (apps/judge/README.md)
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor --yes -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
  | sudo tee /etc/apt/sources.list.d/gvisor.list >/dev/null
sudo apt-get update && sudo apt-get install -y runsc
sudo runsc install
sudo systemctl restart docker

command -v cargo >/dev/null || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
# shellcheck disable=SC1091
. "$HOME/.cargo/env"

sudo infra/sandbox/build.sh
cargo build --release -j 2

echo "== sandbox under gVisor =="
sudo docker run --rm --runtime=runsc --network none ipp-sandbox-python:1 python3 -c 'import os; print(os.uname())'
# `sg docker` picks up the docker group added above without a new login, and keeps the build
# and the Rust toolchain owned by this user (sudo would lose both).
sg docker -c "SANDBOX_RUNTIME=runsc target/release/judge check"
# The integration suite. Fix or report any failure before going live; do not switch to runc.
# (Only the sandbox suite: the queue test needs a scratch Redis, which this host does not have.)
sg docker -c "SANDBOX_RUNTIME=runsc cargo test -p ipp-judge --test sandbox -j 2"

sudo useradd --system --home /var/lib/ipp-judge --create-home --shell /usr/sbin/nologin ipp-judge 2>/dev/null || true
sudo usermod -aG docker ipp-judge
sudo install -D -m 0755 target/release/judge /opt/ipp/judge
sudo install -d -m 0750 -o root -g ipp-judge /etc/ipp
printf 'REDIS_URL=%s\n' "$REDIS_URL" | sudo install -m 0640 -o root -g ipp-judge /dev/stdin /etc/ipp/judge.env
sudo install -m 0644 infra/deploy/judge.service /etc/systemd/system/ipp-judge.service
sudo systemctl daemon-reload
sudo systemctl enable --now ipp-judge
sleep 3
sudo systemctl --no-pager status ipp-judge | head -12
