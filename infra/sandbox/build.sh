#!/usr/bin/env bash
# Builds the interview++ judge sandbox images.
#   infra/sandbox/build.sh            build all three
#   infra/sandbox/build.sh cpp java   build some
# Images are tagged ipp-sandbox-<language>:<SANDBOX_VERSION>; the judge reads the names from
# JUDGE_IMAGE_CPP / JUDGE_IMAGE_PYTHON / JUDGE_IMAGE_JAVA (defaults: the tags built here).
# Bump SANDBOX_VERSION (and the judge's defaults) whenever a Dockerfile, the supervisor or a driver
# changes, so a running judge never mixes old and new images.
set -euo pipefail
SANDBOX_VERSION="${SANDBOX_VERSION:-1}"
here="$(cd "$(dirname "$0")" && pwd)"
langs=("$@")
[ ${#langs[@]} -eq 0 ] && langs=(cpp python java)
for lang in "${langs[@]}"; do
  echo ">> building ipp-sandbox-${lang}:${SANDBOX_VERSION}"
  docker build --pull=false -t "ipp-sandbox-${lang}:${SANDBOX_VERSION}" -f "${here}/${lang}/Dockerfile" "${here}"
done
