#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
command -v node >/dev/null || { printf 'Install Node.js 22.16+ (LTS) from https://nodejs.org/ and run bash setup.sh again.\n' >&2; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<16)){console.error("Node.js 22.16+ is required. Install an LTS version from https://nodejs.org/");process.exit(1)}'
command -v npm >/dev/null || { printf 'npm is required; reinstall Node.js with npm included.\n' >&2; exit 1; }
printf 'Installing locked dependencies without lifecycle scripts...\n'
npm ci --ignore-scripts
printf '\nChecking the included build with synthetic data...\n'
node scripts/smoke.mjs
printf '\nInstalled. No school connection or sign-in was started.\n'
if command -v codex >/dev/null; then
  printf '\nTo connect Codex, copy this command into your terminal:\n'
  printf 'codex mcp add brightspace -- %q %q serve\n' "$(command -v node)" "$PWD/dist/index.js"
fi
printf '\nClaude Desktop: Settings > Developer > Edit Config. Merge this JSON entry, then quit and reopen Claude:\n'
node dist/index.js config-client --client claude-desktop
printf '\nClaude Code: copy this command into your terminal (Bash/zsh):\n'
node dist/index.js config-client --client claude-code
printf '\nCodex: merge this TOML entry into config.toml:\n'
node dist/index.js config-client --client codex
printf '\nReload your MCP host after adding the server.\nOnly connect a real school account when your institution authorizes this use.\nSee README.md and docs/AUTHENTICATION.md for optional sign-in and troubleshooting.\n'
