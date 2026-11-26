#!/usr/bin/env bash
# Provisions interview++ on Google Compute Engine with the active gcloud project/region/zone.
# Each step is a subcommand so it can be read, run and re-run on its own:
#
#   infra/deploy/gcp.sh network        VPC, firewall rules, NAT, static IP (prints the IP for DNS)
#   infra/deploy/gcp.sh vms            ipp-app (public 80/443) and ipp-judge (no public address)
#   infra/deploy/gcp.sh push           copy this repository to both VMs (no .env, no build output)
#   infra/deploy/gcp.sh deploy HOST    update the app VM: copy the repository, then build, migrate,
#                                      seed and restart there (setup-app.sh). Not the judge VM.
#   infra/deploy/gcp.sh ci-identity OWNER/REPO
#                                      one-time: let that GitHub repository's deploy workflow run
#                                      `deploy` (docs/DEPLOY.md "Deploying from GitHub")
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

# Unpacks a tarball of the repository into /opt/ipp-src on one VM. Files are added and replaced;
# nothing is removed (infra/deploy/.env.prod lives there) except the paths listed in `removed`,
# when given: one path per line, relative to the repository. Only a regular file or a link at
# such a path is removed, before unpacking.
push_to() {
  local vm=$1 tarball=$2 removed=${3:-}
  gcloud compute scp --quiet --zone "$ZONE" --tunnel-through-iap "$tarball" "$vm:/tmp/ipp.tgz"
  if [ -n "$removed" ]; then
    gcloud compute scp --quiet --zone "$ZONE" --tunnel-through-iap "$removed" "$vm:/tmp/ipp-removed.txt"
  fi
  gcloud compute ssh "$vm" --quiet --zone "$ZONE" --tunnel-through-iap --command \
    'sudo mkdir -p /opt/ipp-src && cd /opt/ipp-src && if [ -f /tmp/ipp-removed.txt ]; then while IFS= read -r p; do if [ -f "$p" ] || [ -L "$p" ]; then sudo rm -f -- "$p" && echo "removed $p (no longer in the repository)"; fi; done < /tmp/ipp-removed.txt; rm -f /tmp/ipp-removed.txt; fi && sudo tar -xzf /tmp/ipp.tgz -C /opt/ipp-src && sudo chown -R "$USER" /opt/ipp-src && rm /tmp/ipp.tgz'
}

# Every path this commit's history once had and the commit no longer has, one per line: what a
# copy unpacked over an older one still holds and should not. Never an env file, and nothing that
# could leave the repository's directory. From a shallow clone the list is only what its history
# shows, so it may be short, never wrong.
removed_paths() {
  local dir
  dir=$(mktemp -d)
  git -C "$ROOT" -c core.quotePath=false log --pretty=format: --name-only --no-renames HEAD \
    | LC_ALL=C sort -u > "$dir/ever"
  git -C "$ROOT" -c core.quotePath=false ls-tree -r --name-only HEAD | LC_ALL=C sort > "$dir/now"
  LC_ALL=C comm -23 "$dir/ever" "$dir/now" \
    | grep -Ev '^$|^/|(^|/)\.\.(/|$)|(^|/)\.env[^/]*$' || true
  rm -rf "$dir"
}

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
    for vm in "$APP" "$JUDGE"; do push_to "$vm" "$tmp/ipp.tgz"; done
    rm -rf "$tmp"
    ;;
  deploy)
    host=${2:?usage: gcp.sh deploy <hostname>}
    [[ $host =~ ^[A-Za-z0-9.-]+$ ]] || { echo "error: '$host' is not a hostname" >&2; exit 2; }
    # Ships the commit that is checked out (git archive), not the working tree: nothing untracked
    # (a .env, CI credential files) can travel, and what runs is a commit you can name.
    if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]; then
      echo "warning: uncommitted changes are NOT deployed; deploying the last commit." >&2
    fi
    echo "Deploying $(git -C "$ROOT" log -1 --format='%h %s') to $APP ($host)"
    tmp=$(mktemp -d)
    git -C "$ROOT" archive --format=tar.gz -o "$tmp/ipp.tgz" HEAD
    # The VM's copy is unpacked over the last one, so a file deleted from the repository would
    # stay there and still be built: a deleted page stays a route, and one that imports something
    # since removed fails the build. Take those away first.
    if [ "$(git -C "$ROOT" rev-parse --is-shallow-repository)" = true ]; then
      echo "warning: shallow clone; files deleted before its history began stay on the VM." >&2
    fi
    removed_paths > "$tmp/removed.txt"
    push_to "$APP" "$tmp/ipp.tgz" "$tmp/removed.txt"
    rm -rf "$tmp"
    # IPP_NO_SECRET_OUTPUT: setup-app.sh does not print the judge's Redis URL (this output may be a CI log).
    gcloud compute ssh "$APP" --quiet --zone "$ZONE" --tunnel-through-iap \
      --ssh-flag=-o --ssh-flag=ServerAliveInterval=30 --command \
      "cd /opt/ipp-src && IPP_NO_SECRET_OUTPUT=1 infra/deploy/setup-app.sh '$host'"
    ;;
  ci-identity)
    repo=${2:?usage: gcp.sh ci-identity <owner/repo>}
    [[ $repo =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "error: '$repo' is not owner/repo" >&2; exit 2; }
    project=$(gcloud config get-value project 2>/dev/null)
    number=$(gcloud projects describe "$project" --format='value(projectNumber)')
    pool=${WIF_POOL:-github}
    provider=${WIF_PROVIDER:-github-ipp}
    sa="ipp-deploy@$project.iam.gserviceaccount.com"
    member="serviceAccount:$sa"

    # `gcloud compute ssh` as a service account goes through OS Login. Turning it on changes how
    # everyone logs in to every VM of the project, so this only checks.
    if [ "$(gcloud compute project-info describe --format='value(commonInstanceMetadata.items.enable-oslogin)')" != "TRUE" ]; then
      echo "error: OS Login is off for $project. Turn it on first:" >&2
      echo "  gcloud compute project-info add-metadata --metadata enable-oslogin=TRUE" >&2
      exit 1
    fi
    gcloud services enable iamcredentials.googleapis.com sts.googleapis.com iap.googleapis.com oslogin.googleapis.com

    if ! gcloud iam service-accounts describe "$sa" >/dev/null 2>&1; then
      gcloud iam service-accounts create ipp-deploy --display-name "interview++ deploy (GitHub Actions)"
    fi
    # A new service account takes up to a minute to become visible to IAM.
    bind() {
      local i err
      err=$(mktemp)
      for i in $(seq 1 12); do
        if "$@" >/dev/null 2>"$err"; then rm -f "$err"; return 0; fi
        grep -q "does not exist" "$err" || break
        echo "  ($sa not visible to IAM yet; retrying in 5 s)"; sleep 5
      done
      cat "$err" >&2; rm -f "$err"; return 1
    }
    # Project-wide: read instance details and open an IAP tunnel. Neither logs in anywhere.
    bind gcloud projects add-iam-policy-binding "$project" --member "$member" --role roles/compute.viewer --condition None
    bind gcloud projects add-iam-policy-binding "$project" --member "$member" --role roles/iap.tunnelResourceAccessor --condition None
    # Logging in (with sudo) is granted on the app VM only: not the judge, not other projects' VMs.
    bind gcloud compute instances add-iam-policy-binding "$APP" --zone "$ZONE" --member "$member" --role roles/compute.osAdminLogin

    if ! gcloud iam workload-identity-pools describe "$pool" --location global >/dev/null 2>&1; then
      gcloud iam workload-identity-pools create "$pool" --location global --display-name "GitHub Actions"
    fi
    # Only workflows of this repository running on its main branch can become the service account.
    if ! gcloud iam workload-identity-pools providers describe "$provider" \
      --workload-identity-pool "$pool" --location global >/dev/null 2>&1; then
      gcloud iam workload-identity-pools providers create-oidc "$provider" \
        --workload-identity-pool "$pool" --location global --display-name "GitHub Actions (interview++)" \
        --issuer-uri "https://token.actions.githubusercontent.com" \
        --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
        --attribute-condition "assertion.repository == '$repo' && assertion.ref == 'refs/heads/main'"
    fi
    bind gcloud iam service-accounts add-iam-policy-binding "$sa" --role roles/iam.workloadIdentityUser \
      --member "principalSet://iam.googleapis.com/projects/$number/locations/global/workloadIdentityPools/$pool/attribute.repository/$repo"
    provider_name=$(gcloud iam workload-identity-pools providers describe "$provider" \
      --workload-identity-pool "$pool" --location global --format='value(name)')
    cat <<EOF

Done. Set the repository variables (IPP_SITE_HOST is the site's hostname):

  gh variable set GCP_PROJECT_ID --repo $repo --body '$project'
  gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo $repo --body '$provider_name'
  gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --repo $repo --body '$sa'
  gh variable set IPP_ZONE --repo $repo --body '$ZONE'
  gh variable set IPP_SITE_HOST --repo $repo --body 'interview.example.com'

The next push to main then deploys the app VM (.github/workflows/deploy.yml).
EOF
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
  *) sed -n '2,18p' "$0"; exit 1 ;;
esac
