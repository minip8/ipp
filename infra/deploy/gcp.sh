#!/usr/bin/env bash
# Provisions interview++ on Google Compute Engine with the active gcloud project/region/zone.
# Each step is a subcommand so it can be read, run and re-run on its own:
#
#   infra/deploy/gcp.sh network        VPC, firewall rules, NAT, static IP (prints the IP for DNS)
#   infra/deploy/gcp.sh vms            ipp-app (public 80/443) and ipp-judge (no public address)
#   infra/deploy/gcp.sh push           copy this repository to both VMs (no .env, no build output)
#   infra/deploy/gcp.sh lockdown       after setup: judge VM may only talk to Redis on the app VM
#   infra/deploy/gcp.sh unlock         temporarily lift that (to rebuild images or update packages)
#   infra/deploy/gcp.sh ssh-app | ssh-judge
#   infra/deploy/gcp.sh destroy        delete everything created here
#
# Creates billable resources. Read docs/DEPLOY.md first.
set -euo pipefail

NET=ipp
APP=ipp-app
JUDGE=ipp-judge
REGION=$(gcloud config get-value compute/region 2>/dev/null)
ZONE=$(gcloud config get-value compute/zone 2>/dev/null)
MACHINE_APP=${MACHINE_APP:-e2-standard-2}
MACHINE_JUDGE=${MACHINE_JUDGE:-e2-standard-2}
IMAGE=(--image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud)
ROOT=$(cd "$(dirname "$0")/../.." && pwd)

app_internal_ip() { gcloud compute instances describe "$APP" --zone "$ZONE" --format='value(networkInterfaces[0].networkIP)'; }

case "${1:-}" in
  network)
    gcloud compute networks create "$NET" --subnet-mode=auto
    gcloud compute firewall-rules create ipp-web --network "$NET" --allow tcp:80,tcp:443,udp:443 --target-tags "$APP"
    # SSH only through Identity-Aware Proxy.
    gcloud compute firewall-rules create ipp-ssh-iap --network "$NET" --allow tcp:22 --source-ranges 35.235.240.0/20
    gcloud compute firewall-rules create ipp-redis --network "$NET" --allow tcp:6379 --source-tags "$JUDGE" --target-tags "$APP"
    # Outbound internet for the judge VM during setup (it has no public address).
    gcloud compute routers create ipp-router --network "$NET" --region "$REGION"
    gcloud compute routers nats create ipp-nat --router ipp-router --region "$REGION" \
      --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges
    gcloud compute addresses create ipp-app-ip --region "$REGION"
    echo "Point your DNS A record (Cloudflare: DNS only, not proxied) at:"
    gcloud compute addresses describe ipp-app-ip --region "$REGION" --format='value(address)'
    ;;
  vms)
    gcloud compute instances create "$APP" --zone "$ZONE" --machine-type "$MACHINE_APP" "${IMAGE[@]}" \
      --network "$NET" --address ipp-app-ip --tags "$APP" --boot-disk-size 40GB \
      --no-service-account --no-scopes --shielded-secure-boot
    gcloud compute instances create "$JUDGE" --zone "$ZONE" --machine-type "$MACHINE_JUDGE" "${IMAGE[@]}" \
      --network "$NET" --no-address --tags "$JUDGE" --boot-disk-size 40GB \
      --no-service-account --no-scopes --shielded-secure-boot
    ;;
  push)
    tmp=$(mktemp -d)
    tar -C "$ROOT" -czf "$tmp/ipp.tgz" \
      --exclude=node_modules --exclude=target --exclude=.next --exclude=.next-e2e --exclude=.turbo \
      --exclude=.git --exclude='.env' --exclude='.env.prod' --exclude=test-results --exclude=__pycache__ \
      --exclude='apps/web/e2e/.screens' --exclude='apps/web/public/monaco' .
    for vm in "$APP" "$JUDGE"; do
      gcloud compute scp --zone "$ZONE" --tunnel-through-iap "$tmp/ipp.tgz" "$vm:/tmp/ipp.tgz"
      gcloud compute ssh "$vm" --zone "$ZONE" --tunnel-through-iap --command \
        'sudo mkdir -p /opt/ipp-src && sudo tar -xzf /tmp/ipp.tgz -C /opt/ipp-src && sudo chown -R "$USER" /opt/ipp-src && rm /tmp/ipp.tgz'
    done
    rm -rf "$tmp"
    ;;
  lockdown)
    ip=$(app_internal_ip)
    gcloud compute firewall-rules create ipp-judge-egress-redis --network "$NET" --direction EGRESS --priority 900 \
      --action ALLOW --rules tcp:6379 --destination-ranges "$ip/32" --target-tags "$JUDGE"
    gcloud compute firewall-rules create ipp-judge-egress-deny --network "$NET" --direction EGRESS --priority 1000 \
      --action DENY --rules all --destination-ranges 0.0.0.0/0 --target-tags "$JUDGE"
    ;;
  unlock)
    gcloud compute firewall-rules delete ipp-judge-egress-deny ipp-judge-egress-redis --quiet
    ;;
  ssh-app) gcloud compute ssh "$APP" --zone "$ZONE" --tunnel-through-iap ;;
  ssh-judge) gcloud compute ssh "$JUDGE" --zone "$ZONE" --tunnel-through-iap ;;
  destroy)
    gcloud compute instances delete "$APP" "$JUDGE" --zone "$ZONE"
    gcloud compute firewall-rules delete ipp-web ipp-ssh-iap ipp-redis ipp-judge-egress-deny ipp-judge-egress-redis --quiet || true
    gcloud compute routers nats delete ipp-nat --router ipp-router --region "$REGION" --quiet
    gcloud compute routers delete ipp-router --region "$REGION" --quiet
    gcloud compute addresses delete ipp-app-ip --region "$REGION" --quiet
    gcloud compute networks delete "$NET" --quiet
    ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
