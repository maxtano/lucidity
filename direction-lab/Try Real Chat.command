#!/bin/zsh
cd "${0:A:h}"
export PATH="$HOME/.nvm/versions/node/v23.3.0/bin:$PATH"
exec node scripts/chat.mjs
