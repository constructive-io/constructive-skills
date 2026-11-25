#!/usr/bin/env bash
set -euo pipefail

skill_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
while IFS='=' read -r key value || [[ -n "$key" ]]; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  if [[ -z "${!key:-}" ]]; then
    export "$key=$value"
  fi
done < "$skill_dir/devnet.env.example"

query() {
  local endpoint=$1 payload=$2
  shift 2
  curl -q -fsS --max-time 20 --header 'Content-Type: application/json' \
    --data "$payload" "$@" "$endpoint" |
    jq -ce 'if ((.errors // []) | length) > 0 then error(.errors | map(.message) | join(", ")) else .data // error("Missing GraphQL data") end'
}

platform_query() {
  local token
  token=${CONSTRUCTIVE_DEVNET_PLATFORM_TOKEN:?Inject the devnet platform credential}
  printf 'Authorization: Bearer %s\n' "$token" |
    query "$1" "$2" --header @-
}

case "${1:-probe}" in
  probe)
    for endpoint in "$CONSTRUCTIVE_DEVNET_AUTH_ENDPOINT" "$CONSTRUCTIVE_DEVNET_API_ENDPOINT" \
      "$CONSTRUCTIVE_DEVNET_MODULES_ENDPOINT" "$CONSTRUCTIVE_DEVNET_AGENT_ENDPOINT" \
      "$CONSTRUCTIVE_DEVNET_COMPUTE_ENDPOINT"; do
      query "$endpoint" '{"query":"query { __typename }"}' |
        jq -ce --arg endpoint "$endpoint" 'if .__typename == "Query" then {endpoint: $endpoint, reachable: true} else error("Unexpected GraphQL response") end'
    done
    ;;
  whoami)
    platform_query "$CONSTRUCTIVE_DEVNET_AUTH_ENDPOINT" '{"query":"query { currentUserId }"}' |
      jq -ce '{userId: (.currentUserId // error("The credential did not resolve to a user"))}'
    ;;
  databases)
    platform_query "$CONSTRUCTIVE_DEVNET_API_ENDPOINT" \
      '{"query":"query { databases(first: 5) { nodes { id name } pageInfo { hasNextPage endCursor } } }"}' |
      jq -ce '.databases // error("Missing database list")'
    ;;
  *)
    printf 'Usage: %s [probe|whoami|databases]\n' "$0" >&2
    exit 2
    ;;
esac
