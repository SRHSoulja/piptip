# Discord Achievement System Integration Tests

Comprehensive test suite for PIPtip's Discord achievement system, designed to ensure flawless performance during viral moments and edge cases.

## Overview

This test suite covers all critical integration scenarios for the Discord achievement system:

- **Notification Throttling & Viral Moments** - High-volume notification handling
- **Button Handler Reliability** - Rapid clicking and concurrent interactions
- **WebSocket Stability** - Real-time connection management
- **Mobile Discord Compatibility** - iOS/Android app compatibility
- **Multi-Server Configuration** - Permission and routing validation
- **Edge Case & Error Handling** - Graceful degradation testing
- **Performance Benchmarks** - Load testing and optimization

## Quick Start

### Run All Tests
```bash
# Run the complete test suite
npx tsx tests/run_achievement_tests.ts

# Run with custom configuration
npx tsx tests/run_achievement_tests.ts --concurrency=5 --timeout=60
```

### Run Individual Test Suites
```bash
# Main integration tests
npx tsx tests/achievement_integration_tests.ts

# Viral notification tests
npx tsx tests/viral_notification_tests.ts

# Mobile compatibility tests
npx tsx tests/mobile_compatibility_tests.ts

# Edge case tests
npx tsx tests/edge_case_tests.ts

# Existing load tests
npx tsx scripts/load_testing/achievement_load_test.ts
```

## Test Categories

### 1. Achievement Integration Tests
**File**: `tests/achievement_integration_tests.ts`
**Purpose**: Core functionality and integration validation
**Duration**: ~15 minutes

Tests include:
- Achievement unlock notification flow
- Button interaction handlers
- WebSocket real-time monitoring
- Multi-server permission handling
- Database integrity validation

```bash
npx tsx tests/achievement_integration_tests.ts
```

### 2. Viral Notification Tests
**File**: `tests/viral_notification_tests.ts`
**Purpose**: High-volume notification throttling and spam prevention
**Duration**: ~10 minutes

Scenarios tested:
- 1000+ users unlocking same achievement within 60 seconds
- Channel spam prevention strategies
- Batched notification systems
- Achievement milestone celebrations
- Recovery after viral moments

```bash
# Default configuration (1000 concurrent users)
npx tsx tests/viral_notification_tests.ts

# Custom viral test parameters
VIRAL_TEST_USERS=500 VIRAL_TEST_DURATION=30 npx tsx tests/viral_notification_tests.ts
```

### 3. Mobile Compatibility Tests
**File**: `tests/mobile_compatibility_tests.ts`
**Purpose**: Discord mobile app compatibility validation
**Duration**: ~8 minutes

Device testing includes:
- iPhone SE (2022) through iPhone 14 Pro Max
- Galaxy S23 series and Pixel devices
- iPad and Galaxy Tab tablets
- iOS 16+ and Android 13+ compatibility
- Touch target accessibility validation
- Embed and modal responsive design

```bash
npx tsx tests/mobile_compatibility_tests.ts
```

### 4. Edge Case & Error Handling Tests
**File**: `tests/edge_case_tests.ts`
**Purpose**: System resilience and graceful degradation
**Duration**: ~12 minutes

Critical scenarios:
- Permission loss during notifications
- Database connection failures
- Discord API rate limiting (429 responses)
- Memory exhaustion under load
- Data corruption handling
- Concurrent modification conflicts

```bash
npx tsx tests/edge_case_tests.ts
```

### 5. Existing Load Tests
**File**: `scripts/load_testing/achievement_load_test.ts`
**Purpose**: High-volume achievement processing
**Duration**: ~12 minutes (configurable)

Performance validation:
- 1000+ concurrent users
- Achievement definition scaling
- Database query optimization
- Memory usage patterns
- Response time percentiles

```bash
# Default load test (1000 users, 10 minutes)
npx tsx scripts/load_testing/achievement_load_test.ts

# Custom load test parameters
LOAD_TEST_USERS=2000 LOAD_TEST_DURATION=15 npx tsx scripts/load_testing/achievement_load_test.ts
```

## Configuration Options

### Environment Variables

```bash
# Test runner configuration
TEST_CONCURRENT_USERS=100          # Number of concurrent test users
TEST_DURATION=60                   # Test duration in seconds
TEST_OUTPUT_DIR=./tests/results    # Output directory for reports

# Viral notification test configuration
VIRAL_TEST_USERS=1000              # Peak concurrent users for viral tests
VIRAL_TEST_DURATION=60             # Burst duration in seconds
VIRAL_TEST_THROTTLING=true         # Enable notification throttling

# Load test configuration
LOAD_TEST_USERS=1000               # Concurrent users for load tests
LOAD_TEST_DURATION=10              # Test duration in minutes
LOAD_TEST_ACTIONS_PER_MINUTE=6     # Actions per user per minute
LOAD_TEST_ACHIEVEMENTS=50          # Number of achievement definitions
```

### Command Line Options

```bash
# Master test runner options
npx tsx tests/run_achievement_tests.ts [options]

--sequential                       # Run tests one at a time (default: parallel)
--no-report                        # Skip generating detailed reports
--concurrency=N                    # Set max parallel tests (default: 3)
--timeout=N                        # Set timeout in minutes (default: 30)
--help                             # Show help message
```

## Test Reports

All tests generate comprehensive reports in `./tests/results/`:

### Report Types
- **JSON Reports**: Detailed machine-readable results
- **Markdown Summaries**: Human-readable test summaries
- **Performance Metrics**: Response times, throughput, error rates
- **Recommendations**: Actionable insights for improvements

### Sample Report Structure
```
tests/results/
├── achievement_integration_test_1234567890.json
├── achievement_integration_summary_1234567890.md
├── viral_notification_test_1234567890.json
├── viral_notification_summary_1234567890.md
├── mobile_compatibility_1234567890.json
├── mobile_compatibility_summary_1234567890.md
└── edge_case_test_1234567890.json
```

### Key Metrics Tracked
- **Response Times**: Average, P95, P99 percentiles
- **Error Rates**: Success/failure ratios
- **Throughput**: Requests per second
- **Resource Usage**: Memory, CPU, database connections
- **User Impact**: None, minimal, moderate, severe
- **Graceful Degradation**: Error handling effectiveness

## Pre-Launch Validation

### Critical Test Requirements
For production deployment, all tests must meet these criteria:

✅ **Integration Tests**: 100% pass rate
✅ **Viral Moment Handling**: <3s average response time during 1000+ user bursts
✅ **Mobile Compatibility**: 90%+ success rate across all devices
✅ **Edge Case Resilience**: 95%+ graceful degradation rate
✅ **Load Performance**: >100 requests/second sustained throughput

### Pass/Fail Criteria

#### ✅ Production Ready
- All integration tests pass
- Viral notification throttling effective (0 rate limit violations)
- Mobile compatibility >90% across all devices
- Edge cases handled gracefully (>95% success)
- Load tests show stable performance under viral conditions

#### ❌ Not Production Ready
- Any integration test failures
- Rate limit violations during viral tests
- Mobile compatibility <85%
- Critical edge case failures (severe user impact)
- Performance degradation under load

## Test Development

### Adding New Test Cases

1. **Create Test File**:
```typescript
// tests/new_feature_tests.ts
import { TestSuiteBase } from './test_utils.js';

class NewFeatureTestSuite extends TestSuiteBase {
  async runTests() {
    // Implement test logic
  }
}
```

2. **Register in Test Runner**:
```typescript
// tests/run_achievement_tests.ts
{
  name: 'New Feature Tests',
  script: 'tests/new_feature_tests.ts',
  category: 'integration',
  priority: 3,
  // ... other config
}
```

3. **Follow Patterns**:
   - Use consistent error handling
   - Generate JSON and Markdown reports
   - Include performance metrics
   - Test graceful degradation
   - Validate data integrity

### Mock System Guidelines

All tests use mock Discord clients and services:

- **MockDiscordClient**: Simulates Discord bot interactions
- **MockMobileClient**: Mobile-specific behavior simulation
- **ErrorInjector**: Controlled error condition testing
- **NetworkSimulator**: Connection and latency simulation

## Troubleshooting

### Common Issues

#### Test Timeouts
```bash
# Increase timeout for slower systems
npx tsx tests/run_achievement_tests.ts --timeout=60
```

#### Database Connection Errors
```bash
# Ensure test database is available
DATABASE_URL=postgresql://test:test@localhost:5432/piptip_test npx tsx tests/achievement_integration_tests.ts
```

#### Memory Issues During Load Tests
```bash
# Reduce concurrent users for lower-spec systems
LOAD_TEST_USERS=100 npx tsx scripts/load_testing/achievement_load_test.ts
```

#### Permission Errors
```bash
# Ensure proper file permissions
chmod +x tests/*.ts
```

### Performance Tuning

For better test performance:
- Use SSD storage for faster I/O
- Ensure adequate RAM (8GB+ recommended)
- Close unnecessary applications
- Use `--sequential` flag for resource-constrained systems

### Debug Mode

Enable verbose logging:
```bash
DEBUG=piptip:* npx tsx tests/achievement_integration_tests.ts
```

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Achievement Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npx tsx tests/run_achievement_tests.ts --no-report
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: test-results
          path: tests/results/
```

### Pre-Deployment Checklist
- [ ] All integration tests pass
- [ ] Viral moment handling validated
- [ ] Mobile compatibility confirmed
- [ ] Edge cases tested and handled
- [ ] Performance benchmarks met
- [ ] Error rates within acceptable limits
- [ ] Graceful degradation confirmed
- [ ] Data integrity validated

## Support

For test-related issues:
1. Check the troubleshooting section above
2. Review test logs in `tests/results/`
3. Ensure all dependencies are installed
4. Verify environment configuration
5. Run tests individually to isolate issues

## Contributing

When adding new tests:
1. Follow existing patterns and naming conventions
2. Include comprehensive error handling
3. Generate detailed reports with metrics
4. Test both success and failure scenarios
5. Document expected behaviors and thresholds
6. Update this README with new test information

---

These tests ensure PIPtip's Discord achievement system is ready for viral moments while maintaining excellent user experience across all platforms and edge cases.