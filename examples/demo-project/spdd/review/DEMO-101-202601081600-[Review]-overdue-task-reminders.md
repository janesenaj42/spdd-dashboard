# Code Review: Overdue task reminders

| Field | Value |
|---|---|
| Status | Approved with findings |
| Date | 2026-01-08 |

## Findings

| ID | Finding | Status |
|---|---|---|
| RF-1 | `OverdueTaskFinder` compares due dates in server time, not UTC (see RSK-2). | Fixed |
| RF-2 | T-2 does not cover two job runs overlapping. | Open |
