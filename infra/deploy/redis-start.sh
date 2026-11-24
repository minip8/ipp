#!/bin/sh
# Writes the ACL file from the environment and starts Redis. Passwords must not contain spaces.
set -eu
: "${REDIS_PASSWORD:?}" "${REDIS_JUDGE_PASSWORD:?}"
umask 077
cat > /tmp/users.acl <<ACL
user default on >${REDIS_PASSWORD} ~* &* +@all
user judge on >${REDIS_JUDGE_PASSWORD} resetkeys ~judge:* resetchannels &judge:* -@all +xreadgroup +xadd +xack +xdel +xgroup|create +xpending +xclaim +xautoclaim +publish +ping +hello +auth +client|setname +client|setinfo
ACL
exec redis-server --appendonly yes --aclfile /tmp/users.acl --protected-mode yes
