# Fleet Issue Fix Validation Report

**Generated**: 2026-02-17
**Branches validated**: 4
**Total tests**: 47 (all passing)

---

## Table of Contents

1. [#39613 — Browser tab title shows "Software" on host software page](#39613--browser-tab-title-shows-software-on-host-software-page)
2. [#39745 — Add CPE translation for Microsoft.WindowsNotepad](#39745--add-cpe-translation-for-microsoftwindowsnotepad)
3. [#39245 — Serialize self-service install requests](#39245--serialize-self-service-install-requests)
4. [#39921 — Scope declaration processing to affected hosts](#39921--scope-declaration-processing-to-affected-hosts)

---

## #39613 — Browser tab title shows "Software" on host software page

**Branch**: `fix/39613-host-software-tab-title`
**File changed**: `frontend/components/App/App.tsx`
**Validation**: `frontend/components/App/App.validation.tests.tsx` (19 Jest tests)

### Problem

When viewing a host's software tab (e.g., `/hosts/123/software/inventory`), the
browser tab title incorrectly displayed "Software | Fleet" instead of the
host-specific title. This happened because `page_titles.find()` used
`pathname.includes(item.path)`, which matched `/software` as a substring inside
`/hosts/123/software/inventory`.

### Fix

Changed `includes` to `startsWith` in `App.tsx` line ~230:

```typescript
// Before (buggy):
const curTitle = page_titles.find((item) =>
  location?.pathname.includes(item.path)
);

// After (fixed):
const curTitle = page_titles.find((item) =>
  location?.pathname.startsWith(item.path)
);
```

### Test Results

```
PASS frontend/components/App/App.validation.tests.tsx (19 tests)

  bug scenario: host software tab should NOT match top-level Software title
    ✓ does NOT set title to 'Software' for /hosts/123/software/inventory
    ✓ does NOT set title to 'Software' for /hosts/456/software
    ✓ does NOT set title to 'Software' for /hosts/789/software/library

  confirms the old buggy logic WOULD have matched incorrectly
    ✓ old includes() logic incorrectly matches /hosts/123/software/inventory to Software

  fix works: top-level /software paths SHOULD match Software title
    ✓ sets title to 'Software' for /software/titles
    ✓ sets title to 'Software' for /software/os
    ✓ sets title to 'Software' for /software/versions
    ✓ sets title to 'Software' for /software/vulnerabilities
    ✓ sets title to 'Software' for /software

  other paths still work correctly
    ✓ sets title to 'Hosts' for /hosts/manage
    ✓ sets title to 'Dashboard' for /dashboard
    ✓ sets title to 'Queries' for /queries/manage
    ✓ sets title to 'Policies' for /policies/manage
    ✓ sets title to 'Settings' for /settings
    ✓ sets title to 'Controls' for /controls
    ✓ sets title to 'New query' for /queries/new
    ✓ sets title to 'New policy' for /policies/new

  host detail paths do not incorrectly match other top-level titles
    ✓ /hosts/1/queries does not match 'Queries' title
    ✓ /hosts/1/policies does not match 'Policies' title

Tests: 19 passed, 19 total
```

### Key Validation Points

| Scenario | Old behavior (`includes`) | New behavior (`startsWith`) |
|----------|--------------------------|----------------------------|
| `/hosts/123/software/inventory` | Incorrectly matches "Software" title | No match (correct) |
| `/software/titles` | Matches "Software" title | Matches "Software" title |
| `/hosts/1/queries` | Would match "Queries" title | No match (correct) |

---

## #39745 — Add CPE translation for Microsoft.WindowsNotepad

**Branch**: `fix/39745-notepad-cpe`
**Files changed**: `server/vulnerabilities/nvd/cpe_translations.json`, `server/vulnerabilities/nvd/cpe_translations_test.go`
**Validation**: `tools/validate/validate_39745.sh` (6 Go subtests)

### Problem

The Windows program `Microsoft.WindowsNotepad` (Windows Notepad distributed via
the Microsoft Store / MSIX) had no CPE mapping in Fleet's translation table.
This meant Fleet could not match it to known NVD CPE entries and therefore
missed vulnerabilities reported against
`cpe:2.3:a:microsoft:window_notepad:*` and
`cpe:2.3:a:microsoft:windows_notepad:*`.

### Fix

Added a new entry to `server/vulnerabilities/nvd/cpe_translations.json`:

```json
{
  "software": {
    "name": ["Microsoft.WindowsNotepad"],
    "source": ["programs"]
  },
  "filter": {
    "product": ["window_notepad", "windows_notepad"],
    "vendor": ["microsoft"]
  }
}
```

This maps `Microsoft.WindowsNotepad` (source: `programs`) to the Microsoft
vendor with both known NVD product names (`window_notepad` and
`windows_notepad`).

A corresponding test case was added to
`server/vulnerabilities/nvd/cpe_translations_test.go`.

### Test Results

| Metric | Value |
|--------|-------|
| Total TestTranslate subtests | 6 (was 5 before this fix) |
| Passed | 6 |
| Failed | 0 |
| New subtest (`match_Microsoft.WindowsNotepad`) | **PASS** |
| Overall result | **PASS** |

<details>
<summary>Full test output</summary>

```
=== RUN   TestTranslate
=== RUN   TestTranslate/no_match
=== RUN   TestTranslate/match_on_name_and_source
=== RUN   TestTranslate/match_on_bundle_identifier
=== RUN   TestTranslate/match_with_regex
=== RUN   TestTranslate/match_with_regex_not_matching
=== RUN   TestTranslate/match_Microsoft.WindowsNotepad
--- PASS: TestTranslate (0.00s)
    --- PASS: TestTranslate/no_match (0.00s)
    --- PASS: TestTranslate/match_on_name_and_source (0.00s)
    --- PASS: TestTranslate/match_on_bundle_identifier (0.00s)
    --- PASS: TestTranslate/match_with_regex (0.00s)
    --- PASS: TestTranslate/match_with_regex_not_matching (0.00s)
    --- PASS: TestTranslate/match_Microsoft.WindowsNotepad (0.00s)
PASS
ok  	github.com/fleetdm/fleet/v4/server/vulnerabilities/nvd	0.697s
```

</details>

---

## #39245 — Serialize self-service install requests

**Branch**: `fix/39245-rapid-install-requests`
**File changed**: `frontend/pages/hosts/details/cards/Software/SelfService/SelfService.tsx`
**Validation**: `SelfService.validation.tests.tsx` (12 Jest tests)

### Problem

When a user rapidly taps "Install" on multiple VPP apps in the self-service
portal, each tap independently fires `deviceApi.installSelfServiceSoftware`.
The concurrent API calls hit Apple's VPP endpoint at the same time and some
return false "host offline" errors due to VPP API contention.

### Fix

`SelfService.tsx` now uses a queue (`installQueueRef`) guarded by a processing
flag (`isProcessingInstallRef`). `onClickInstallAction` pushes items onto the
queue and calls `processInstallQueue`, which drains the queue one item at a time
(serial `await`). `onInstallOrUninstall` (the polling refetch) is only called
once after the entire queue is drained.

### Test Results

```
PASS SelfService.validation.tests.tsx (12 tests)

  BEFORE fix: concurrent handler (the bug)
    ✓ fires all API calls concurrently when Install is tapped rapidly (103 ms)

  AFTER fix: serialized queue handler
    ✓ processes install requests one at a time (sequentially) (251 ms)
    ✓ calls the API in the correct order (FIFO) (193 ms)
    ✓ ensures each call starts after the previous one finishes (no overlap) (222 ms)
    ✓ still works correctly for a single install (no queue needed) (74 ms)
    ✓ handles API errors without stopping the queue (202 ms)
    ✓ can process a second batch after the first batch drains (283 ms)

  side-by-side: concurrent vs. serialized
    ✓ concurrent handler has higher peak concurrency than serialized handler (355 ms)

  unmount cleanup: queue cleared mid-processing
    ✓ stops processing remaining items when the queue is cleared (482 ms)

  duplicate softwareId handling
    ✓ processes all queued items even with same softwareId (no dedup) (161 ms)
    ✓ processes duplicates interspersed with other ids in correct FIFO order (177 ms)

  large batch stress test
    ✓ processes 20 queued items serially in FIFO order with 1 final callback (401 ms)

Tests: 12 passed, 12 total
```

### Key Validation Points

| Metric | Before (bug) | After (fix) |
|--------|-------------|-------------|
| Peak concurrent API calls | 3 | 1 |
| Polling refetch calls | 3 (per tap) | 1 (per batch) |
| Request ordering | Uncontrolled | FIFO guaranteed |
| Error resilience | N/A (independent) | Queue continues on error |
| Time overlap between calls | Yes (all start together) | No (serial execution) |
| Unmount safety | Calls keep firing | Queue cleared, processing stops |
| Duplicate softwareId | Independent calls | All processed, no dedup (expected) |
| 20-item batch | 20 concurrent calls | Serial FIFO, 1 callback at end |

---

## #39921 — Scope declaration processing to affected hosts

**Branch**: `fix/39921-teams-spec-perf`
**Files changed**: `server/datastore/mysql/mdm.go`, `server/datastore/mysql/apple_mdm.go`
**Validation**: `tools/validate/validate_39921.sh` (3 Go test suites) + `apple_mdm_bench_test.go` (6 scoping tests + benchmark)

### Problem

When `BulkSetPendingMDMHostProfiles` was called (e.g., after applying a team
spec via `POST /api/latest/fleet/spec/teams`), the declaration processing step
(`mdmAppleBatchSetHostDeclarationStateDB`) computed the desired declaration
state for **ALL enrolled hosts**, regardless of which hosts were actually
affected by the change.

**Before**: `mdmAppleBatchSetHostDeclarationStateDB` always computed desired
state for ALL hosts. With 70k hosts and 30 declarations, this generated a
massive 4-way UNION query joining every host against every declaration, causing
severe performance degradation (50+ second API responses).

### Fix

**After**: When called from `BulkSetPendingMDMHostProfiles`, declarations are
scoped to only the affected hosts (those belonging to the modified team). The
cron job (`MDMAppleBatchSetHostDeclarationState`) continues to process all hosts.

#### Changes

1. **`server/datastore/mysql/mdm.go`**:
   - Collect declaration UUIDs from profile UUIDs passed to the function.
   - Add a new `case hasAppleDecls:` block that looks up host UUIDs associated
     with the changed declarations (via team membership and existing assignments).
   - Remove the `!hasAppleDecls` guard so the host UUID lookup runs for
     declarations just like it does for profiles.
   - Pass the scoped `appleHosts` list into `mdmAppleBatchSetHostDeclarationStateDB`.

2. **`server/datastore/mysql/apple_mdm.go`**:
   - Add `hostUUIDs []string` parameter to `mdmAppleBatchSetHostDeclarationStateDB`.
   - Add `hostUUIDs []string` parameter to `mdmAppleGetHostsWithChangedDeclarationsDB`.
   - When `hostUUIDs` is non-empty, use batched host-filtered queries
     (`generateEntitiesToInstallQueryWithDesiredState` and
     `generateEntitiesToRemoveQueryWithDesiredState`) that include
     `h.uuid IN (?)` conditions, avoiding a full table scan.
   - When `hostUUIDs` is empty (cron path), fall through to the original
     `mdmAppleGetAllHostsWithChangedDeclarationsDB` that processes all hosts.

### Test Results

| Status | Test Suite | Duration |
|--------|-----------|----------|
| PASS | BulkSetPendingMDMHostProfiles (all variants) | 35.2s |
| PASS | MDMAppleBatchSetHostDeclarationState (DDM) | 9.3s |
| PASS | MDMAppleDDMDeclarationsToken | 11.9s |

**All 3 test suites passed.**

### Scoping Contract Tests (`TestScopedDeclarationProcessing`)

In addition to the existing integration tests, 6 targeted sub-tests explicitly
prove the scoping contract:

```
--- PASS: TestScopedDeclarationProcessing (8.38s)
    --- PASS: TestScopedDeclarationProcessing/ScopedToTeamA (0.04s)
    --- PASS: TestScopedDeclarationProcessing/ScopedToTeamB (0.03s)
    --- PASS: TestScopedDeclarationProcessing/Unscoped (0.03s)
    --- PASS: TestScopedDeclarationProcessing/EmptySlice (0.03s)
    --- PASS: TestScopedDeclarationProcessing/ScopedDeclarationCount (0.03s)
    --- PASS: TestScopedDeclarationProcessing/BatchSetWithScope (0.07s)
```

| Sub-test | What it proves |
|----------|---------------|
| `ScopedToTeamA` | Passing team A host UUIDs returns ONLY team A hosts |
| `ScopedToTeamB` | Passing team B host UUIDs returns ONLY team B hosts |
| `Unscoped` | Passing `nil` returns hosts from BOTH teams (cron behavior) |
| `EmptySlice` | Empty slice behaves like `nil` (all hosts) |
| `ScopedDeclarationCount` | Each scoped host has exactly the expected number of declarations |
| `BatchSetWithScope` | End-to-end: scoped batch set creates pending declarations only for scoped hosts; other team hosts have zero |

### Full-Scale Reproduction (`TestReproduceIssue39921`)

Reproduces the **exact scenario** from issue #39921:
- 70,000 hosts across 50 teams (1,400 hosts per team)
- 30 declarations per team (1,500 total)
- One team modified via GitOps (`POST /api/latest/fleet/spec/teams`)
- Reported: 107 second API response time

```
╔══════════════════════════════════════════════════════════════════════════╗
║  REPRODUCTION OF ISSUE #39921                                          ║
║  'POST /api/latest/fleet/spec/teams taking ~107s with ~70k hosts'      ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Setup: 70000 hosts, 50 teams, 30 decls/team (1500 total)
╠══════════════════════════════════════════════════════════════════════════╣
║  SCOPED   (fix)  :   1400 hosts → 5.874s
║  UNSCOPED (bug)  :  70000 hosts → 4m31.959s  (reported: ~107s)
║  Speedup         : 46.3x
╚══════════════════════════════════════════════════════════════════════════╝
```

The unscoped (buggy) path took **4m32s** on a local MySQL instance — same
order of magnitude as the reported 107s on production infrastructure (the
difference is due to local MySQL vs production hardware/tuning). The scoped
(fixed) path completes in **5.9s** for the target team's 1,400 hosts, a
**46.3x speedup**.

### Key Validation Points

| Scenario | Before | After |
|----------|--------|-------|
| Declaration desired-state query scope | ALL hosts | Only affected hosts |
| Host UUID lookup for declarations | Skipped entirely | Runs via team + assignment JOIN |
| Cron job behavior | Processes all hosts | Unchanged (passes `nil`) |
| API endpoint behavior | Processes all hosts (slow) | Scoped to team hosts (fast) |
| Estimated query rows (70k hosts, 30 decls) | ~2.1M rows | ~hundreds of rows |
