#!/bin/sh
set -eu

npm run prisma:deploy
if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  node prisma/seed.js
fi
exec node src/index.js
