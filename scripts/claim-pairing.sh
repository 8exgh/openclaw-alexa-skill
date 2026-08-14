#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: BRIDGE_URL=https://... PAIRING_ADMIN_TOKEN=... $0 <six-digit-code> <claw-id>" >&2
  exit 2
fi
: "${BRIDGE_URL:?BRIDGE_URL is required}"
: "${PAIRING_ADMIN_TOKEN:?PAIRING_ADMIN_TOKEN is required}"

curl --fail --silent --show-error \
  -X POST "${BRIDGE_URL%/}/admin/pair/claim" \
  -H "Authorization: Bearer ${PAIRING_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"code\":\"$1\",\"clawId\":\"$2\"}"
echo
