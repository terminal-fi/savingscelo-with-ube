#!/bin/bash
set -e
trap 'jobs -p | xargs -r kill || true' EXIT
echo "Starting celo-devchain on port 7545, logs: /tmp/savingscelo.celo-devchain.log ..."
yarn celo-devchain --port 7545 &> /tmp/savingscelo.celo-devchain.log &
while ! nc -z localhost 7545; do
  sleep 0.1 # wait for 1/10 of the second before check again
done
yarn compile:ts
if [ -z $1 ]; then
  find ./dist/src/tests -name "test*.js" | xargs yarn truffle test --bail
else
  yarn truffle test --bail $1
fi
