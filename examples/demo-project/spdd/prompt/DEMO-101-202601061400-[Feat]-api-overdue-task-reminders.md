# REASONS Canvas: Overdue task reminders

| Field | Value |
|---|---|
| Version | 1.1 |
| Status | Ready for generation |
| Date | 2026-01-06 |

## R — Requirements

Send one email per overdue task within an hour, skip done tasks, respect the owner's setting.

## E — Entities

- `Task`: gains `reminderSentAt`, a nullable timestamp.
- `OwnerSettings`: gains `remindersEnabled`, default true.

## A — Approach

A scheduled job selects tasks where `dueAt < now`, `status != done` and `reminderSentAt is null`,
then sends one email each and sets `reminderSentAt`.

## S — Structure

`ReminderJob` → `OverdueTaskFinder` → `Mailer`.

## O — Operations

| ID | Operation | Status |
|---|---|---|
| OP-1 | Add `reminderSentAt` to `Task` with a migration. | Planned |
| OP-2 | Add `remindersEnabled` to `OwnerSettings`. | Planned |
| OP-3 | Write `OverdueTaskFinder.find(now)`. | Planned |
| OP-4 | Schedule `ReminderJob` every 15 minutes. | Planned |

## N — Norms

Follow the existing job and mailer patterns. Log each email sent with the task ID.

## S — Safeguards

| ID | Test | Status |
|---|---|---|
| T-1 | A done task gets no email. | Planned |
| T-2 | A task gets at most one email. | Planned |
| T-3 | An owner with reminders off gets no email. | Planned |
