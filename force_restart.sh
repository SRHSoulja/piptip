#!/bin/bash

# force_restart.sh - Force restart PIPTip to clear module cache
# This is needed when Node.js module caching prevents new code from loading

set -e

PM2_PROCESS_NAME="pipbot"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "🔄 Force restarting PIPTip to clear module cache..."

# Stop the process completely
log "🛑 Stopping PM2 process '$PM2_PROCESS_NAME'..."
pm2 stop "$PM2_PROCESS_NAME" || log "⚠️  Process was not running"

# Wait a moment for graceful shutdown
sleep 3

# Start the process fresh (this clears all module cache)
log "🚀 Starting PM2 process '$PM2_PROCESS_NAME' fresh..."
pm2 start "$PM2_PROCESS_NAME"

# Wait for startup
log "⏳ Waiting for application startup..."
sleep 10

# Check status
log "📊 PM2 Status:"
pm2 describe "$PM2_PROCESS_NAME" | grep -E "(status|uptime)"

log "✨ Force restart complete! Module cache cleared."