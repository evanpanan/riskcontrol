## [LRN-20260921-001] correction

**Logged**: 2026-09-21
**Priority**: critical
**Status**: resolved
**Area**: tests

### Summary
UI persistence does not prove financial correctness.

### Details
Previous margin-call checks proved that a client's displayed amount survived reload,
but did not verify execution price, purchased shares, institution ownership,
capital-versus-profit separation, or frozen settlement proceeds. Legacy batch
receipts also cannot be assigned to clients without an allocation record.

### Suggested Action
Run `npm run verify:finance`, TypeScript, production build, and `npm run verify:preview`.
Keep legacy amounts and client state intact, label missing execution/allocation data,
and block ambiguous payouts rather than fabricating a price or a distribution.
Do not describe browser-local bookkeeping as an executed brokerage trade or payment.

### Metadata
- Source: user_feedback
- Related Files: src/lib/riskEngine.ts, src/lib/mockData.ts, scripts/check-finance.ts
- Tags: finance, settlement, migration, verification

### Resolution
- Added independent institution trades, margin rounds, immutable settlement snapshots,
  and regression cases for conservation, repeat rounds, rounding, storage failures,
  signing rates, and legacy allocation isolation.
- Confirmed business rule: do not chase small price changes after a locked round;
  reopen only when total account assets reach 80% of the remaining original baseline.
- Browser MCP descriptors may move after workspace changes; discover their current
  location before using tools instead of assuming a restored descriptor path exists.

## [LRN-20260921-002] best_practice

**Logged**: 2026-09-21
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Validate rendered branding, linked-page aggregates, and notification acceptance independently.

### Details
Avatar gradients defined in src/lib were absent from Tailwind's scan paths.
Manager-profile totals used institution-inclusive batch assets despite correct client rows.
Notification buttons and configuration fields did not prove delivery: WhatsApp requires
approved templates, and partial acceptance must not be presented as complete success.
Renaming visible role labels also requires updating literal assertions in root-level tests.

### Suggested Action
Check narrow-card geometry and actual computed styles. Sum client-specific metrics for
manager totals, exclude closed positions from current assets, and flag missing snapshots.
Keep external delivery tests simulated unless real credentials and recipients are authorized.

### Metadata
- Source: error
- Related Files: tailwind.config.ts, src/app/bd/[bdName]/page.tsx, src/lib/server/notificationDelivery.ts, test_datascope_rbac.ts
- Tags: branding, notifications, finance, regression

### Resolution
- Included src/lib in Tailwind scanning, fixed footer layout, unified profile totals,
  added channel-specific tests, and synchronized the renamed RBAC placeholder assertion.
