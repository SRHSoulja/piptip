# Dynamic Achievement System - Production Deployment Guide

## 🚀 Phase 1: Safe Migration Strategy

### Pre-Deployment Checklist

```bash
# 1. Schema validation
npx prisma generate
npx tsx scripts/validate_achievement_schema.ts

# 2. Production readiness check
npx tsx scripts/production_readiness_check.ts

# 3. Build verification
npm run build

# 4. Environment validation
npx tsx src/services/env_validator.ts
```

### Migration Phases

#### Phase 1A: Legacy-Only (Current State)
- ✅ Existing static achievements continue working
- ✅ No user impact during deployment
- ✅ Admin can monitor system health

#### Phase 1B: Hybrid Mode (Migration Phase)
```bash
# Initialize dynamic achievements
npx tsx scripts/seed_dynamic_achievements.ts

# Start gradual user migration
curl -X POST "https://your-domain/admin/migration/run" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "batchSize": 50,
    "maxBatches": 10,
    "dryRun": true
  }'

# After validating dry run results
curl -X POST "https://your-domain/admin/migration/run" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "batchSize": 50,
    "maxBatches": 10,
    "dryRun": false
  }'
```

#### Phase 1C: Dynamic-Only (Final State)
- ✅ All users migrated to dynamic system
- ✅ Legacy system disabled
- ✅ Full admin control available

## 🎛️ Phase 2: Admin UI Quick Wins

### Immediate Admin Benefits

#### Emergency Controls (Zero-Downtime)
```bash
# Disable all deposit achievements instantly
curl -X POST "https://your-domain/admin/quick-wins/emergency/disable-all" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "category": "deposits",
    "reason": "Regulatory compliance review"
  }'

# Re-enable after review
curl -X POST "https://your-domain/admin/quick-wins/emergency/enable-all" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "category": "deposits",
    "reason": "Review complete"
  }'
```

#### Threshold Adjustments (Business-Driven)
```bash
# Make achievements 50% harder
curl -X POST "https://your-domain/admin/quick-wins/bulk-threshold" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "achievementIds": [1, 2, 3, 4],
    "multiplier": 1.5
  }'
```

#### Real-Time Impact Preview
```bash
# Preview impact before applying changes
curl -X POST "https://your-domain/admin/achievements/preview" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "change_threshold",
    "achievementIds": [5],
    "changes": { "newThreshold": 100 }
  }'

# Response shows:
# - "237 users would lose this achievement"
# - "45 users would gain this achievement"
# - Estimated processing time
```

### Admin Dashboard Features

#### System Health
```bash
GET /admin/system/status
```
Returns:
- Migration phase status
- Performance metrics
- Table size analysis
- Optimization suggestions

#### User Support Lookup
```bash
GET /admin/quick-wins/user-lookup/DISCORD_ID_HERE
```
Returns:
- All user achievements
- Progress on pending achievements
- Near-completion achievements (80%+)

## ⚡ Phase 3: Performance Optimizations

### Database Scaling Strategy

#### Progress Table Management
```bash
# Archive completed progress (reduces table size)
curl -X POST "https://your-domain/admin/optimize/archive-progress" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{ "olderThanDays": 30 }'

# Clean stale progress entries
curl -X POST "https://your-domain/admin/optimize/cleanup-stale" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{ "staleAfterDays": 90 }'
```

#### Batch Processing
- ✅ Optimized user processing (100 users/batch)
- ✅ Transaction-safe progress updates
- ✅ Concurrent definition processing (max 3)
- ✅ Automatic error recovery and retry

### Scaling Triggers

| Metric | Threshold | Action |
|--------|-----------|---------|
| Progress entries | 100K+ | Enable archiving |
| Progress entries | 500K+ | Implement partitioning |
| Achievement unlocks | 50K+ | Monitor performance |
| Processing time | >5min | Increase batch size |

## 🔧 Phase 4: Business Logic Separation

### Criteria System

#### Built-in Evaluators
```javascript
// Available criteria types
{
  "count": "Simple counts (matches won, tips sent)",
  "sum": "Aggregate values (total tip amount)",
  "streak": "Streak tracking (current/longest wins)",
  "unique": "Unique counts (different tip recipients)",
  "custom": "Complex business logic (consecutive days)"
}
```

#### Adding New Criteria
```typescript
// Example: Add "seasonal" criteria
class SeasonalEvaluator implements CriteriaEvaluator {
  type = 'seasonal';

  async evaluate(userId: number, criteriaData: any): Promise<number> {
    const { season, activity } = criteriaData;
    // Implementation specific to your seasonal events
    return calculatedProgress;
  }

  validateConfig(criteriaData: any) {
    // Validation logic
    return { valid: true, errors: [] };
  }
}

// Register the evaluator
CriteriaRegistry.register(new SeasonalEvaluator());
```

#### Database vs Code Separation

**✅ Store in Database:**
- Achievement names and descriptions
- Thresholds and targets
- Display properties (icons, colors)
- Enable/disable flags
- Time-gating rules

**✅ Keep in Code:**
- Complex calculation logic
- External API integrations
- Multi-step validation rules
- Cross-system dependencies

## 🎯 Phase 5: Production Monitoring

### Key Metrics Dashboard

#### Achievement Health
```bash
GET /admin/quick-wins/stats/overview
```
Tracks:
- Completion rates by achievement
- Category performance
- Recent activity trends
- Easy vs. hard achievement identification

#### Real-Time Activity
```javascript
// WebSocket connection for live monitoring
const ws = new WebSocket('wss://your-domain/admin/achievements');

ws.on('achievement_unlocked', (event) => {
  console.log(`🏆 ${event.data.userDiscordId} unlocked ${event.data.achievementName}`);
});

ws.on('rare_achievement_unlocked', (unlocks) => {
  console.log(`✨ ${unlocks.length} rare achievements unlocked`);
});
```

### Alerts and Notifications

#### Set Up Monitoring
1. **High unlock rate**: Achievement may be too easy
2. **Low unlock rate**: Achievement may be too hard
3. **Processing delays**: Scale performance optimization
4. **Error spikes**: Check criteria evaluation logic

## 🛡️ Production Safety

### Emergency Procedures

#### System Issues
```bash
# Disable entire achievement system
curl -X PUT "https://your-domain/admin/config" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -d '{ "achievementsEnabled": false }'

# Disable just streak protection
curl -X PUT "https://your-domain/admin/config" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -d '{ "streakProtectionEnabled": false }'
```

#### Rollback Strategy
- ✅ 24-hour rollback window for all changes
- ✅ Version tracking for all definition updates
- ✅ Automatic backup before bulk operations
- ✅ Migration reversal tools available

### Testing Strategy

#### Before Major Changes
```bash
# 1. Preview impact
POST /admin/achievements/preview

# 2. Dry-run migration
POST /admin/migration/run { "dryRun": true }

# 3. Small batch test
POST /admin/migration/run { "batchSize": 10, "maxBatches": 1 }

# 4. Monitor for 24 hours before full rollout
```

## 📈 Success Metrics

### Week 1: Deployment Success
- ✅ Zero downtime during migration
- ✅ No user-facing errors
- ✅ Admin can disable/enable achievements
- ✅ Migration progress > 50%

### Week 2: Admin Adoption
- ✅ Emergency controls tested
- ✅ Threshold adjustments made
- ✅ Preview system used for impact analysis
- ✅ Migration progress > 90%

### Month 1: Business Value
- ✅ Achievement difficulty optimized based on completion rates
- ✅ Seasonal/limited achievements launched
- ✅ A/B testing different thresholds
- ✅ Support ticket reduction (user lookup tool)

### Month 3: Scale Validation
- ✅ UserAchievementProgress table size managed
- ✅ Batch processing handling user growth
- ✅ Performance optimization automated
- ✅ New achievement types added via criteria system

## 🔗 Integration Points

### Web Dashboard
```
https://your-domain/admin/achievements
```

### API Endpoints
```
GET    /admin/system/status           # System health
GET    /admin/achievements            # List definitions
POST   /admin/achievements            # Create definition
PUT    /admin/achievements/:id        # Update definition
DELETE /admin/achievements/:id        # Delete definition
POST   /admin/achievements/preview    # Preview changes
POST   /admin/quick-wins/emergency/*  # Emergency controls
```

### WebSocket Monitoring
```
wss://your-domain/admin/achievements
```

This deployment strategy ensures **zero-risk migration** with **immediate business value** while building foundation for **Netflix-scale achievement management**.

The key is the **phased approach**: start with quick wins (emergency disable), build confidence with preview system, then gradually migrate users while maintaining full backward compatibility.