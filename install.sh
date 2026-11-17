#!/usr/bin/env bash
set -euo pipefail
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing. Install Node.js 20+ first: https://nodejs.org/"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then echo "npm is missing"; exit 1; fi
if ! command -v java >/dev/null 2>&1; then
  echo "Java is not installed. Install a Java runtime suitable for your Minecraft version."
  echo "Example (Ubuntu/Debian): sudo apt update && sudo apt install -y openjdk-21-jre-headless"
  exit 1
fi
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  sed -i "s/replace-this-with-a-long-random-secret/$SECRET/" .env
  echo "Created .env. IMPORTANT: change ADMIN_PASSWORD before exposing the panel."
fi
npm install --omit=dev
mkdir -p data servers
echo
echo "ANSH Panel installed."
echo "Start it with: npm start"
echo "Open: http://YOUR-VPS-IP:3000"
