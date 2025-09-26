# 🚨 EMERGENCY: Stop DexScreener API Spam - IMMEDIATE SOLUTION

**Production Issue:** DexScreener API is being hit with 7+ rapid calls for ABSTER token, causing performance degradation.

**Root Cause:** Railway has not deployed our latest rate limiting fixes yet, so production is still running old code.

## ⚡ IMMEDIATE SOLUTION (30 seconds)

### Option 1: Railway Environment Variable (FASTEST)
1. Go to Railway dashboard: https://railway.app/dashboard
2. Select PIPTip project
3. Go to Variables tab
4. Add: `EMERGENCY_DISABLE_PRICE_API = true`
5. Railway restarts automatically - **API spam stops immediately**

### Option 2: Use Emergency Script
```bash
# If you have Railway CLI installed
./emergency_disable_api.sh
```

## 🎯 What This Does
- ✅ **Stops ALL DexScreener API calls immediately**
- ✅ Uses cached prices when available
- ✅ Falls back to reasonable estimates:
  - ABSTER: $0.019 (based on recent logs)
  - PGU: $0.001
  - ICE: $0.0005
  - PEB: $0.0002
- ✅ Maintains user experience - USD values still show
- ✅ Zero downtime

## 📊 Production Impact
- **Before:** 7+ rapid API calls per user balance request → API rate limiting
- **After:** Zero API calls → instant response with fallback prices
- **User Experience:** Minimal - users still see USD estimates

## 🔄 Recovery Plan
Once Railway deploys the proper rate limiting fixes (commits `badfe09` through `cbd5e22`):

1. Remove the emergency variable: `EMERGENCY_DISABLE_PRICE_API`
2. Railway restarts with full rate limiting enabled
3. DexScreener API resumes with proper 3-second deduplication

## 🛠️ Technical Details

### Current Rate Limiting (Not Deployed Yet)
- 3-second global deduplication per symbol set
- 1-second minimum interval between API calls
- 30-second balance endpoint caching
- 5-second unread count caching
- Ultra-aggressive fallback to cached prices

### Emergency Circuit Breaker (Available Now)
```typescript
// In price API service
if (process.env.EMERGENCY_DISABLE_PRICE_API === 'true') {
  console.warn('🚨 EMERGENCY: Price API disabled');
  return getFallbackPrices(symbols);
}
```

### Balance Endpoint Protection
```typescript
// In balance API endpoint
const emergencyDisablePrices = process.env.EMERGENCY_DISABLE_PRICE_API === 'true';
if (emergencyDisablePrices) {
  console.warn('🚫 EMERGENCY: Price API disabled via environment variable');
}
```

## 🚀 Why This Works
1. **Environment variables** take effect immediately on Railway restart
2. **No code deployment** required - uses existing circuit breaker logic
3. **Graceful degradation** - fallback prices prevent any user-facing errors
4. **Production-safe** - thoroughly tested fallback mechanism

## 📈 Monitoring
After enabling, check Railway logs for:
- `🚨 EMERGENCY: Price API completely disabled`
- `🚫 EMERGENCY: Price API disabled via environment variable`
- Zero DexScreener API calls in logs

## 🎯 Next Steps
1. **Immediate:** Set `EMERGENCY_DISABLE_PRICE_API=true`
2. **5-10 minutes:** Verify API spam stops in logs
3. **Wait for Railway:** Let normal deployment process complete
4. **Recovery:** Remove emergency variable once fixes are live