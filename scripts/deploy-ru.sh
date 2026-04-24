#!/usr/bin/env bash
# =============================================================================
# deploy-ru.sh — safe deploy script for pulseup-ru (ru.pulseup.me)
#
# Usage:
#   ./scripts/deploy-ru.sh              # build + deploy
#   ./scripts/deploy-ru.sh --no-build   # deploy current .next/ without rebuilding
#
# What this script does:
#   1. Optionally runs `npm run build` locally
#   2. Rsyncs .next/standalone/ to VPS (separate dir from pulseup-v4)
#   3. Separately rsyncs .next/static/ and public/
#   4. Does NOT touch .env.local on the VPS
#   5. Wires runtime env-loader into server.js
#   6. Reinstalls better-sqlite3 on VPS (Linux build)
#   7. Restarts pm2 process 'pulseup-ru'
#   8. Ensures Caddy block exists for ru.pulseup.me (auto-HTTPS via Let's Encrypt)
#   9. Smoke-test: waits for HTTP 200 from https://ru.pulseup.me
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
VPS_HOST="srv1362562.hstgr.cloud"
VPS_USER="root"
VPS_DIR="/var/www/pulseup-ru"
PM2_APP="pulseup-ru"
APP_PORT="3007"
SMOKE_URL="https://ru.pulseup.me"

SSH="${VPS_USER}@${VPS_HOST}"

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}▶ $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠ $*${NC}"; }
error() { echo -e "${RED}✗ $*${NC}"; exit 1; }

# ── Parse flags ───────────────────────────────────────────────────────────────
BUILD=true
for arg in "$@"; do
  [[ "$arg" == "--no-build" ]] && BUILD=false
done

# ── Step 0: sanity checks ─────────────────────────────────────────────────────
[[ -f "package.json" ]] || error "Run this script from the project root (pulseup-ru/)."
[[ -f ".env.local"   ]] || warn ".env.local not found locally — is that expected?"

# ── Step 1: build ─────────────────────────────────────────────────────────────
if $BUILD; then
  info "Building Next.js app..."
  npm run build
else
  warn "Skipping build (--no-build flag)"
  [[ -d ".next/standalone" ]] || error ".next/standalone not found. Run without --no-build first."
fi

# ── Step 2: create VPS directory if needed ───────────────────────────────────
info "Ensuring VPS directory ${VPS_DIR} exists..."
ssh -i ~/.ssh/vps_hostinger "${SSH}" "mkdir -p ${VPS_DIR}"

# ── Step 3: sync standalone output ───────────────────────────────────────────
info "Syncing .next/standalone/ → VPS:${VPS_DIR}/ ..."
rsync -az -e "ssh -i ~/.ssh/vps_hostinger" --delete \
  --exclude 'public/'                        \
  --exclude 'node_modules/better-sqlite3/'   \
  --exclude 'data/'                          \
  --exclude '.next/static/'                  \
  --exclude '.env.local'                     \
  --exclude '.env'                           \
  --exclude 'load-env.js'                    \
  .next/standalone/ "${SSH}:${VPS_DIR}/"

# ── Step 4: sync static assets ───────────────────────────────────────────────
info "Syncing .next/static/ → VPS..."
rsync -az -e "ssh -i ~/.ssh/vps_hostinger" --delete .next/static/ "${SSH}:${VPS_DIR}/.next/static/"

info "Syncing public/ → VPS..."
rsync -az -e "ssh -i ~/.ssh/vps_hostinger" public/ "${SSH}:${VPS_DIR}/public/"

# ── Step 5: upload .env.local if not on VPS (first deploy only) ──────────────
info "Checking .env.local on VPS..."
if ssh -i ~/.ssh/vps_hostinger "${SSH}" "[[ ! -f '${VPS_DIR}/.env.local' ]]"; then
  warn ".env.local NOT found on VPS — uploading it now..."
  scp -i ~/.ssh/vps_hostinger .env.local "${SSH}:${VPS_DIR}/.env.local"
  info ".env.local uploaded."
fi

# ── Step 6: copy SQLite database if not on VPS ────────────────────────────────
info "Checking database on VPS..."
if ssh -i ~/.ssh/vps_hostinger "${SSH}" "[[ ! -f '${VPS_DIR}/data/events.db' ]]"; then
  info "Database not found on VPS — uploading data/events.db..."
  ssh -i ~/.ssh/vps_hostinger "${SSH}" "mkdir -p ${VPS_DIR}/data"
  scp -i ~/.ssh/vps_hostinger data/events.db "${SSH}:${VPS_DIR}/data/events.db"
  info "Database uploaded."
fi

# ── Step 7: wire runtime env-loader into server.js ────────────────────────────
info "Ensuring runtime env-loader is wired into server.js..."
ssh -i ~/.ssh/vps_hostinger "${SSH}" "bash -s" <<REMOTE_EOF
set -e
cd "${VPS_DIR}"

cat > load-env.js <<'LOADER_EOF'
// Loads .env.local into process.env at runtime (Next.js standalone does not).
try {
  const fs = require("fs");
  const path = require("path");
  const envPath = path.join(__dirname, ".env.local");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
    console.log("[env-loader] .env.local loaded");
  }
} catch (e) { console.error("[env-loader] failed:", e.message); }
LOADER_EOF

grep -q 'require("./load-env.js")' server.js || sed -i '1irequire("./load-env.js");' server.js
echo "env-loader OK"
REMOTE_EOF

# ── Step 8: reinstall better-sqlite3 for Linux ────────────────────────────────
info "Reinstalling better-sqlite3 for Linux on VPS..."
ssh -i ~/.ssh/vps_hostinger "${SSH}" "cd ${VPS_DIR} && npm install better-sqlite3 --no-save 2>&1 | tail -5"

# ── Step 9: create/restart pm2 process ───────────────────────────────────────
info "Starting/restarting pm2 process '${PM2_APP}' on port ${APP_PORT}..."
ssh -i ~/.ssh/vps_hostinger "${SSH}" "bash -s" <<REMOTE_EOF
set -e
cd "${VPS_DIR}"

if pm2 describe "${PM2_APP}" > /dev/null 2>&1; then
  pm2 restart "${PM2_APP}"
else
  # PORT env is picked up by Next.js standalone server.js
  PORT="${APP_PORT}" pm2 start server.js --name "${PM2_APP}"
fi

pm2 save
echo "pm2 OK"
REMOTE_EOF

# ── Step 10: ensure Caddy block for ru.pulseup.me ─────────────────────────────
info "Checking Caddy config for ru.pulseup.me..."
ssh -i ~/.ssh/vps_hostinger "${SSH}" "bash -s" <<REMOTE_EOF
set -e

CADDY_BLOCK="ru.pulseup.me {
  import tls_compat
  reverse_proxy localhost:${APP_PORT}
}"

CADDY_FILE="/etc/caddy/Caddyfile"

if grep -q "ru.pulseup.me" "\${CADDY_FILE}" 2>/dev/null; then
  echo "Caddy block already present — skipping"
else
  echo "" >> "\${CADDY_FILE}"
  echo "\${CADDY_BLOCK}" >> "\${CADDY_FILE}"
  echo "Caddy block added. Reloading Caddy..."
  caddy reload --config "\${CADDY_FILE}" --adapter caddyfile
  echo "Caddy reloaded OK"
fi
REMOTE_EOF

# ── Step 11: smoke test ───────────────────────────────────────────────────────
info "Waiting for app to come up (HTTPS + Let's Encrypt may take ~30s first time)..."
sleep 5

MAX_TRIES=12
for i in $(seq 1 $MAX_TRIES); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${SMOKE_URL}" || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    echo -e "${GREEN}✓ Smoke test passed (HTTP ${HTTP_CODE}) — ${SMOKE_URL}${NC}"
    break
  fi
  if [[ $i -eq $MAX_TRIES ]]; then
    error "Smoke test failed after ${MAX_TRIES} tries (last status: ${HTTP_CODE}). Check: pm2 logs ${PM2_APP}"
  fi
  warn "Try ${i}/${MAX_TRIES}: HTTP ${HTTP_CODE}, retrying in 5s..."
  sleep 5
done

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Deploy complete → ${SMOKE_URL}${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
