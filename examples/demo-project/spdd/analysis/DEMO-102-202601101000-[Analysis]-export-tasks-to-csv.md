# SPDD Analysis: Export tasks to CSV

| Field | Value |
|---|---|
| Title | Export tasks to CSV |
| Status | Confirmed |
| Date | 2026-01-10 |
| Input | requirements/export-tasks-to-csv.md |

## Decisions

| ID | Decision | Status |
|---|---|---|
| D-1 | The export streams rows, so large lists do not load into memory. | Accepted |
| D-2 | Dates are written as ISO 8601. | Accepted |
