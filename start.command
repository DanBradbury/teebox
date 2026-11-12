#!/bin/bash
set -u

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org and run this again."
  exit 1
fi

node server.js "$@" &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

url="http://localhost:${WEB_PORT:-3000}"
ready=0
for ((attempt = 0; attempt < 50; attempt++)); do
  if curl --silent --fail --output /dev/null "$url"; then
    ready=1
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    wait "$server_pid"
    exit $?
  fi
  sleep 0.1
done

if ((ready)); then
  open "$url" || echo "Open $url in your browser."
else
  echo "Server did not become ready. Open $url once it starts."
fi

wait "$server_pid"
