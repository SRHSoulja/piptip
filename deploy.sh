Deploy · SH
Download

#!/bin/bash

# deploy.sh - Production deployment script for PIPTip
# Usage: ./deploy.sh [--dry-run] [--skip-health-check]

set -e

# Configuration
APP_DIR="$(pwd)"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/health/healthz}"
MAX_RETRIES=5
RETRY_DELAY=5
PM2_PROCESS_NAME="pipbot"

# Parse command line arguments
DRY_RUN=false
SKIP_HEALTH_CHECK=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --skip-health-check)
      SKIP_HEALTH_CHECK=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--dry-run] [--skip-health-check]"
      exit 1
      ;;
  esac
done

# Logging function
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Error handler
error_exit() {
  log "❌ ERROR: $1"
  exit 1
}

# Check if running as dry run
if [ "$DRY_RUN" = true ]; then
  log "🧪 DRY RUN MODE - No changes will be made"
fi

log "🚀 Starting PIPTip deployment..."

# Verify we're in the right directory
if [ ! -f "package.json" ]; then
  error_exit "package.json not found. Are you in the correct directory?"
fi

if ! grep -q '"name": "piptip"' package.json; then
  error_exit "This doesn't appear to be the PIPTip project directory"
fi

# Verify we're in a git repository
if [ ! -d ".git" ]; then
  error_exit "Not in a git repository"
fi

# Check if PM2 is running the process
if ! pm2 describe "$PM2_PROCESS_NAME" > /dev/null 2>&1; then
  log "⚠️  PM2 process '$PM2_PROCESS_NAME' not found. This may be the first deployment."
fi

# Store current commit for rollback
PREVIOUS_COMMIT=$(git rev-parse HEAD)
log "📝 Current commit: $PREVIOUS_COMMIT"

if [ "$DRY_RUN" = false ]; then
  # Check for local changes before destructive operations
  if [ -n "$(git status --porcelain)" ]; then
    log "⚠️  WARNING: Local changes detected!"
    git status --short
    log "⚠️  These changes will be LOST with hard reset to origin/main"
    read -p "Continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      log "❌ Deployment cancelled by user"
      exit 1
    fi
  fi

  # Fetch latest changes
  log "📥 Fetching latest changes from origin/main..."
  if ! git fetch origin main; then
    error_exit "Failed to fetch from origin/main. Check network connection and git remote."
  fi
  
  # Verify origin/main exists
  if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
    error_exit "origin/main branch not found"
  fi
  
  # Reset to latest main (hard reset - be careful!)
  log "🔄 Resetting to origin/main..."
  git reset --hard origin/main
fi

# Get new commit info
CURRENT_COMMIT=$(git rev-parse HEAD)
CURRENT_COMMIT_SHORT=$(git rev-parse --short HEAD)
log "📝 Target commit: $CURRENT_COMMIT ($CURRENT_COMMIT_SHORT)"

if [ "$CURRENT_COMMIT" = "$PREVIOUS_COMMIT" ]; then
  log "ℹ️  No new commits to deploy"
fi

if [ "$DRY_RUN" = false ]; then
  # Clean npm cache to avoid potential issues
  log "🧹 Cleaning npm cache..."
  npm cache clean --force
  
  # Install dependencies (skip Prisma postinstall to prevent hanging)
  log "📦 Installing production dependencies..."
  if ! PRISMA_SKIP_POSTINSTALL_GENERATE=true npm ci --omit=dev --silent; then
    error_exit "npm ci failed. Check package-lock.json and dependencies."
  fi
  
  # Generate Prisma client
  log "🔧 Generating Prisma client..."
  if ! npx prisma generate; then
    error_exit "Prisma client generation failed"
  fi
  
  # Run database migrations
  log "🗄️  Running database migrations..."
  if ! npx prisma migrate deploy; then
    error_exit "Database migration failed"
  fi
  
  # Build application
  log "🏗️  Building application..."
  if ! npm run build; then
    error_exit "Application build failed"
  fi
  
  # Update environment variables with current git SHA
  log "🔧 Updating environment variables..."
  if [ -f ".env" ]; then
    if grep -q "^GIT_SHA=" .env; then
      # Update existing GIT_SHA
      if command -v sed > /dev/null; then
        sed -i.backup "s/^GIT_SHA=.*/GIT_SHA=$CURRENT_COMMIT_SHORT/" .env
      else
        # Fallback for systems without sed
        grep -v "^GIT_SHA=" .env > .env.tmp && echo "GIT_SHA=$CURRENT_COMMIT_SHORT" >> .env.tmp && mv .env.tmp .env
      fi
    else
      # Add GIT_SHA to .env
      echo "GIT_SHA=$CURRENT_COMMIT_SHORT" >> .env
    fi
  else
    log "⚠️  .env file not found - creating minimal version"
    echo "GIT_SHA=$CURRENT_COMMIT_SHORT" > .env
  fi
  
  # Reload PM2 process
  log "🔄 Reloading PM2 process '$PM2_PROCESS_NAME'..."
  if ! pm2 reload "$PM2_PROCESS_NAME" --update-env; then
    error_exit "PM2 reload failed"
  fi
  
  # Wait for application to start
  log "⏳ Waiting for application startup..."
  sleep 10
else
  log "🧪 DRY RUN: Would clean cache, install dependencies, migrate DB, build, and reload PM2"
fi

# Health check
if [ "$SKIP_HEALTH_CHECK" = false ]; then
  log "🏥 Performing health checks on $HEALTH_URL..."
  
  HEALTH_PASSED=false
  
  for i in $(seq 1 $MAX_RETRIES); do
    log "Health check attempt $i/$MAX_RETRIES..."
    
    if [ "$DRY_RUN" = true ]; then
      log "🧪 DRY RUN: Would check $HEALTH_URL"
      HEALTH_PASSED=true
      break
    fi
    
    # Perform health check
    if curl -f -s --max-time 10 "$HEALTH_URL" > /tmp/health_response.json 2>/dev/null; then
      log "✅ Health check passed!"
      
      # Display health response
      if command -v jq > /dev/null; then
        log "📊 Health status:"
        jq . /tmp/health_response.json
        
        # Validate response structure
        if jq -e '.status == "healthy" and .db.status == "connected"' /tmp/health_response.json > /dev/null; then
          log "✅ Health validation passed!"
          HEALTH_PASSED=true
          break
        else
          log "❌ Health check response validation failed"
          cat /tmp/health_response.json
        fi
      else
        log "📊 Health response: $(cat /tmp/health_response.json)"
        HEALTH_PASSED=true
        break
      fi
    else
      log "❌ Health check failed (attempt $i/$MAX_RETRIES)"
    fi
    
    if [ $i -lt $MAX_RETRIES ]; then
      log "⏳ Waiting ${RETRY_DELAY}s before retry..."
      sleep $RETRY_DELAY
    fi
  done
  
  # Check if health checks ultimately failed
  if [ "$HEALTH_PASSED" = false ] && [ "$DRY_RUN" = false ]; then
    log "🚨 All health checks failed!"
    
    # Automatic rollback
    log "🔄 Performing automatic rollback to $PREVIOUS_COMMIT..."
    git checkout "$PREVIOUS_COMMIT"
    npm ci --omit=dev --silent
    npx prisma generate
    npm run build
    pm2 reload "$PM2_PROCESS_NAME" --update-env
    
    error_exit "Deployment failed and rolled back to $PREVIOUS_COMMIT"
  fi
else
  log "⏭️  Skipping health checks as requested"
fi

# Clean up temporary files
if [ -f "/tmp/health_response.json" ]; then
  rm -f /tmp/health_response.json
fi

log "🎉 Deployment completed successfully!"
log "📝 Deployed commit: $CURRENT_COMMIT_SHORT"
log "⚡ PM2 process: $PM2_PROCESS_NAME"
log "🏥 Health endpoint: $HEALTH_URL"

# Display PM2 status
if command -v pm2 > /dev/null && [ "$DRY_RUN" = false ]; then
  log "📊 PM2 Status:"
  pm2 describe "$PM2_PROCESS_NAME" | grep -E "(status|uptime|cpu|memory)"
fi

log "✨ Deployment complete!"
