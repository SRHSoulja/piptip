#!/bin/bash

# Emergency script to stop DexScreener API spam on Railway
# Run this to immediately disable price API calls without waiting for deployment

echo "🚨 EMERGENCY: Stopping DexScreener API spam on Railway..."

# Check if Railway CLI is available
if command -v railway &> /dev/null; then
    echo "✅ Railway CLI found, setting environment variable..."

    # Set emergency environment variable to disable price API
    railway variables set EMERGENCY_DISABLE_PRICE_API=true

    echo "✅ Emergency variable set: EMERGENCY_DISABLE_PRICE_API=true"
    echo "⏱️ Railway will restart the service automatically with this setting"
    echo "💡 This will stop all DexScreener API calls and use fallback prices only"

    # Check status
    echo ""
    echo "🔍 Current Railway status:"
    railway status

    # Show current variables (filtered)
    echo ""
    echo "🔍 Checking environment variables:"
    railway variables | grep -E "(EMERGENCY|API)" || echo "No emergency variables found yet"

else
    echo "❌ Railway CLI not found"
    echo "📋 Manual steps:"
    echo "   1. Go to Railway dashboard: https://railway.app/dashboard"
    echo "   2. Select your PIPTip project"
    echo "   3. Go to Variables tab"
    echo "   4. Add: EMERGENCY_DISABLE_PRICE_API = true"
    echo "   5. Railway will restart automatically"
    echo ""
    echo "🚨 This will immediately stop all DexScreener API calls!"
fi

echo ""
echo "📊 This emergency fix:"
echo "   ✅ Stops all DexScreener API spam immediately"
echo "   ✅ Uses cached prices when available"
echo "   ✅ Falls back to reasonable estimates:"
echo "      • ABSTER: $0.019"
echo "      • PGU: $0.001"
echo "      • ICE: $0.0005"
echo "      • PEB: $0.0002"
echo "   ✅ Maintains user experience with estimated USD values"
echo "   ✅ Can be removed once deployment fixes are live"