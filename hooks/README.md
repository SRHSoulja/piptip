# Webhooks (Alchemy → PHP → Node)

This folder hosts the PHP webhook that validates Alchemy events and forwards confirmed deposits to your Node bot.

- `alchemy.php` – PHP webhook entrypoint  
- `.env` – Secrets for this webhook only (not committed)  
- `alchemy_deposits.log` – Append-only debug log when WEBHOOK_DEBUG=true

## 1) Endpoint
Point Alchemy to:
    https://YOUR_DOMAIN/hooks/alchemy.php

Flow: verify signature → normalize → POST to Node `/internal/credit` with Bearer.

## 2) .env for /hooks
Copy `.env.example` to `.env` and fill:
    ALCHEMY_SIGNING_KEY=add_here
    TREASURY_AGW_ADDRESS=add_here
    NODE_INTERNAL_CREDIT_URL=http://127.0.0.1:3000/internal/credit
    INTERNAL_BEARER=add_here
    NODE_INTERNAL_BEARER=add_here
    WEBHOOK_DEBUG=true

## 3) Server hardening
Apache .htaccess (optional):
    Options -Indexes
    <Files "alchemy.php">
      <LimitExcept POST>
        Require all denied
      </LimitExcept>
    </Files>

## 4) Test Node internal endpoint (bypass webhook)
    curl -X POST http://127.0.0.1:3000/internal/credit \
      -H "Authorization: Bearer YOUR_INTERNAL_BEARER" \
      -H "Content-Type: application/json" \
      -d '{"tx":"0xTEST","from":"0xSender","to":"0xTreasury","amount":"123.45","token":"PEBBLE"}'

## 5) Troubleshooting
- 401 from PHP → bad Alchemy signature or key
- 403 from Node → bearer mismatch with Node .env INTERNAL_BEARER
- Ignored deposit → TREASURY_AGW_ADDRESS mismatch
- No logs → set WEBHOOK_DEBUG=true and allow web user to write /hooks

# ===== ADD TO: .gitignore (ensure these lines exist) =====
# Webhook secrets/logs
/hooks/.env
/hooks/*.log
