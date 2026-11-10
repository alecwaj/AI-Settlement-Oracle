#!/bin/sh
# Starts TEErminator (verifying proxy to Confidential AI's inference enclaves) and gates the oracle on it.
#
# Two inference modes, chosen in the measured docker-compose.yml (so verifiers can see which one is live):
#
#   VERIFIED   (REQUIRE_ATTESTED_INFERENCE=true): TEERMINATOR_REMOTE_ARGS holds Confidential AI's reviewed pins.
#              TEErminator attests their front door before any prompt leaves this enclave; the container
#              refuses to start unless the verdict is `Verified`.
#   UNVERIFIED (REQUIRE_ATTESTED_INFERENCE=false and no pins yet): calls https://api.confidential.ai/v1
#              directly. Inference still runs on Confidential AI's TEE infrastructure, but this oracle does
#              not check it; the UI and every resolution record say so.
set -eu

PINS="${TEERMINATOR_REMOTE_ARGS:-}"
REQUIRE="${REQUIRE_ATTESTED_INFERENCE:-true}"
case "$PINS" in *REPLACE_WITH_*) HAVE_PINS="" ;; "") HAVE_PINS="" ;; *) HAVE_PINS=1 ;; esac

if [ "${LLM_MODE:-confidential}" = "confidential" ] && [ -n "${TEERMINATOR_BIN:-}" ]; then
  if [ -z "$HAVE_PINS" ]; then
    if [ "$REQUIRE" = "true" ]; then
      echo "FATAL: REQUIRE_ATTESTED_INFERENCE=true but TEERMINATOR_REMOTE_ARGS has no reviewed pins (empty or REPLACE_WITH_ placeholders)." >&2
      exit 1
    fi
    echo "WARNING: UNVERIFIED inference mode: no TEErminator pins, calling Confidential AI directly. Responses are not attestation-checked by this oracle." >&2
    export CONFIDENTIAL_BASE_URL="${CONFIDENTIAL_PUBLIC_BASE:-https://api.confidential.ai}/v1"
    unset TEERMINATOR_BIN
  else
    LOCAL_ADDR="${TEERMINATOR_LOCAL:-127.0.0.1:8080}"
    UPSTREAM="${CONFIDENTIAL_UPSTREAM:-https://api.confidential.ai/}"

    # Idempotent across container restarts.
    "$TEERMINATOR_BIN" remote rm "$LOCAL_ADDR" >/dev/null 2>&1 || true
    # shellcheck disable=SC2086  # word splitting of the flag list is intended
    "$TEERMINATOR_BIN" remote add "$LOCAL_ADDR" "$UPSTREAM" $PINS
    if [ -n "${CONFIDENTIAL_API_KEY:-}" ]; then
      printf '%s' "$CONFIDENTIAL_API_KEY" | "$TEERMINATOR_BIN" remote auth "$LOCAL_ADDR" -
    fi
    "$TEERMINATOR_BIN" start &

    if [ "$REQUIRE" = "true" ]; then
      ok=""
      out=""
      for _ in 1 2 3 4 5 6; do
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
fi

exec "$@"
