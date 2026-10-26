#!/bin/zsh
cd "${0:A:h}"
export PATH="$HOME/.nvm/versions/node/v23.3.0/bin:$PATH"
if [[ ! -d node_modules ]]; then
  print 'First run: installing the local MCP dependency…'
  npm ci || exit 1
fi
open 'http://127.0.0.1:4317'
exec node server.mjs
