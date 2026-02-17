#!/bin/bash
#
# Validation script for issue #39745
# Verifies the CPE translation entry for Microsoft.WindowsNotepad
#

set -euo pipefail

FLEET_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_PKG="./server/vulnerabilities/nvd/"
TEST_NAME="^TestTranslate$"

# Run the test and capture output
cd "$FLEET_ROOT"
TEST_OUTPUT=$(go test "$TEST_PKG" -run "$TEST_NAME" -v -count=1 2>&1) || true

# Count total subtests (lines matching "--- PASS:" or "--- FAIL:" under TestTranslate subtests)
TOTAL_SUBTESTS=$(echo "$TEST_OUTPUT" | grep -c -e 'PASS: TestTranslate/' -e 'FAIL: TestTranslate/' || true)
PASSED_SUBTESTS=$(echo "$TEST_OUTPUT" | grep -c -e 'PASS: TestTranslate/' || true)
FAILED_SUBTESTS=$(echo "$TEST_OUTPUT" | grep -c -e 'FAIL: TestTranslate/' || true)

# Check if our specific subtest passed
NOTEPAD_RESULT="FAIL"
if echo "$TEST_OUTPUT" | grep -q 'PASS: TestTranslate/match_Microsoft.WindowsNotepad'; then
  NOTEPAD_RESULT="PASS"
fi

# Check overall test result
OVERALL="FAIL"
if echo "$TEST_OUTPUT" | grep -q '^PASS$'; then
  OVERALL="PASS"
fi

cat <<EOF
## Validation: #39745 -- Add CPE translation for Microsoft.WindowsNotepad

### Problem

The Windows program \`Microsoft.WindowsNotepad\` (Windows Notepad distributed via
the Microsoft Store / MSIX) had no CPE mapping in Fleet's translation table.
This meant Fleet could not match it to known NVD CPE entries and therefore
missed vulnerabilities reported against
\`cpe:2.3:a:microsoft:window_notepad:*\` and
\`cpe:2.3:a:microsoft:windows_notepad:*\`.

### Fix

Added a new entry to \`server/vulnerabilities/nvd/cpe_translations.json\`:

\`\`\`json
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
\`\`\`

This maps \`Microsoft.WindowsNotepad\` (source: \`programs\`) to the Microsoft
vendor with both known NVD product names (\`window_notepad\` and
\`windows_notepad\`).

A corresponding test case was added to
\`server/vulnerabilities/nvd/cpe_translations_test.go\`.

### Test Results

| Metric                       | Value           |
|------------------------------|-----------------|
| Total TestTranslate subtests | ${TOTAL_SUBTESTS} (was 5 before this fix) |
| Passed                       | ${PASSED_SUBTESTS}              |
| Failed                       | ${FAILED_SUBTESTS}              |
| New subtest (match_Microsoft.WindowsNotepad) | **${NOTEPAD_RESULT}** |
| Overall result               | **${OVERALL}**  |

<details>
<summary>Full test output</summary>

\`\`\`
${TEST_OUTPUT}
\`\`\`

</details>
EOF
