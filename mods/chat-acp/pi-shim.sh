#!/bin/sh
# pi-acp starts `pi` from PATH. This copy is placed first on PATH so the chat can
# set an access mode and a coordinator prompt. CHAT_ACP_PI is the real binary.
# The script never reads or prints secrets.
if [ -z "$CHAT_ACP_PI" ] || [ ! -x "$CHAT_ACP_PI" ]; then
  echo "chat-acp: real pi binary is missing" >&2
  exit 127
fi
sys=
if [ -n "$CHAT_ACP_SYSTEM_FILE" ] && [ -f "$CHAT_ACP_SYSTEM_FILE" ]; then
  sys=$(cat "$CHAT_ACP_SYSTEM_FILE")
fi
if [ -n "$sys" ] && [ "$CHAT_ACP_ACCESS" = "read" ]; then
  exec "$CHAT_ACP_PI" --append-system-prompt "$sys" --tools read,grep,find,ls "$@"
fi
if [ -n "$sys" ]; then
  exec "$CHAT_ACP_PI" --append-system-prompt "$sys" "$@"
fi
if [ "$CHAT_ACP_ACCESS" = "read" ]; then
  exec "$CHAT_ACP_PI" --tools read,grep,find,ls "$@"
fi
exec "$CHAT_ACP_PI" "$@"
