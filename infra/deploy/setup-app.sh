#!/usr/bin/env bash
# Run on the app VM from /opt/ipp-src:   infra/deploy/setup-app.sh interview.example.com
# Installs Docker, creates infra/deploy/.env.prod with generated secrets (first run only),
# builds the images, migrates and seeds the database, and starts the stack.
# The server takes no Anthropic key: users supply their own in the app.
set -euo pipefail
SITE_HOST=${1:?usage: setup-app.sh <hostname>}
cd "$(dirname "$0")"

if ! command -v docker >/dev/null; then
  sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
  sudo usermod -aG docker "$USER"
fi
DC="sudo docker compose --env-file .env.prod -f compose.prod.yml"

if [ ! -f .env.prod ]; then
  umask 077
  cat > .env.prod <<ENV
SITE_HOST=$SITE_HOST
POSTGRES_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
REDIS_JUDGE_PASSWORD=$(openssl rand -hex 24)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
REDIS_BIND_IP=$(hostname -I | awk '{print $1}')
ENV
  echo "Created .env.prod (optional settings: see env.prod.example)."
fi

$DC build
$DC run --rm tools pnpm db:migrate
$DC run --rm tools pnpm db:seed
$DC up -d
$DC ps
# Not when the output goes to a CI log (gcp.sh deploy sets this): the URL contains a password.
if [ -z "${IPP_NO_SECRET_OUTPUT:-}" ]; then
  echo
  echo "Judge REDIS_URL (put it in /etc/ipp/judge.env on the judge VM):"
  echo "  REDIS_URL=redis://judge:$(grep '^REDIS_JUDGE_PASSWORD=' .env.prod | cut -d= -f2)@$(grep '^REDIS_BIND_IP=' .env.prod | cut -d= -f2):6379"
fi
