#!/bin/sh
# Starts TEErminator (verifying proxy to Confidential AI's inference enclaves) and gates the oracle on it.
#
# TEERMINATOR_REMOTE_ARGS holds the production pins (`--mode attest-lb ... --image-manifest/--measurements
# --expected-rtmr3 --pin-policy sha256:...`). It is set in the measured docker-compose.yml, so anyone who
# verifies this CVM's compose hash can read exactly which inference enclave policy the oracle enforces.
set -eu

if [ "${LLM_MODE:-confidential}" = "confidential" ] && [ -n "${TEERMINATOR_BIN:-}" ]; then
  LOCAL_ADDR="${TEERMINATOR_LOCAL:-127.0.0.1:8080}"
  UPSTREAM="${CONFIDENTIAL_UPSTREAM:-https://api.confidential.ai/}"

  if [ -z "${TEERMINATOR_REMOTE_ARGS:-}" ]; then
    if [ "${REQUIRE_ATTESTED_INFERENCE:-true}" = "true" ]; then
      echo "FATAL: TEERMINATOR_REMOTE_ARGS is empty; refusing to run without inference-enclave pins." >&2
      exit 1
    fi
    echo "WARNING: no TEERMINATOR_REMOTE_ARGS; TEErminator will not attest the upstream." >&2
  fi
  case "${TEERMINATOR_REMOTE_ARGS:-}" in
    *REPLACE_WITH_*)
      echo "FATAL: TEERMINATOR_REMOTE_ARGS still contains REPLACE_WITH_ placeholders; fill in the reviewed pins." >&2
      exit 1 ;;
  esac

  # Idempotent across container restarts.
  "$TEERMINATOR_BIN" remote rm "$LOCAL_ADDR" >/dev/null 2>&1 || true
  # shellcheck disable=SC2086  # word splitting of the flag list is intended
  "$TEERMINATOR_BIN" remote add "$LOCAL_ADDR" "$UPSTREAM" ${TEERMINATOR_REMOTE_ARGS:-}
  if [ -n "${CONFIDENTIAL_API_KEY:-}" ]; then
    printf '%s' "$CONFIDENTIAL_API_KEY" | "$TEERMINATOR_BIN" remote auth "$LOCAL_ADDR" -
  fi

  "$TEERMINATOR_BIN" start &

  if [ "${REQUIRE_ATTESTED_INFERENCE:-true}" = "true" ]; then
    ok=""
    for i in 1 2 3 4 5 6; do
      out="$("$TEERMINATOR_BIN" status 2>&1 || true)"
      echo "$out" | grep -E "^${LOCAL_ADDR}[[:space:]]" || true
      if echo "$out" | grep -E "^${LOCAL_ADDR}[[:space:]].*[[:space:]]Verified[[:space:]]*$" >/dev/null; then ok=1; break; fi
      sleep 5
    done
    if [ -z "$ok" ]; then
      echo "FATAL: TEErminator did not verify the Confidential AI inference enclave." >&2
      echo "$out" >&2
      exit 1
    fi
    echo "TEErminator: inference enclave Verified."
  fi
fi

exec "$@"
