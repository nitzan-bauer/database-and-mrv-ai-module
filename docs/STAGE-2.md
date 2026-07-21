# Stage 2 — Permissions, tokens, audit

## ✅ Done — 21 July 2026, with one deliberate deferral

| Plan item | Status |
|---|---|
| `users` | ✅ |
| `project_memberships` | ✅ |
| `audit_log` | ✅ append-only, trigger-enforced |
| `agent_action_policies` | ✅ seeded with the spec's AUTO/CONFIRM defaults |
| `agent_memory` | ✅ pgvector(1536) + HNSW index |
| `mcp_tokens` | ⏭️ **moved to stage 3** — see below |
| Append-only triggers | ✅ `audit_log`, `ghg_parameters` |
| RLS policies keyed on `project_id` | ✅ written, inert |
| **Acceptance: every action logged with who/what/when** | ✅ enforced by trigger |

## The acceptance criterion, and how it was nearly missed

The plan's test for this stage is that *every action is recorded in the audit log with who, what and when*. For a while this stage looked finished because `audit_log` existed, was correctly shaped, and rejected `UPDATE` and `DELETE`.

A check against the live database showed **2 rows**, both from verification probes. Nothing was writing to it. The table was a promise, not a record.

The fix was to stop treating audit as something the application does. Migration `0008` puts triggers on every mutable core table, so a change is logged regardless of who made it or how:

```
update mrv.plots set crop = '...' where plot_id = 'ELD-WP-01';

actor = mrv_admin                                  ← direct database change
actor = 00000000-0000-0000-0000-00000000abcd       ← application, app.user_id set
```

That distinction is the point. An application that bypasses its own API, a manual `psql` fix at 2am, a migration — all land in the log. The actor resolves from `app.user_id` when the connection sets it, and falls back to the database role otherwise, so a row attributed to `mrv_admin` visibly means *someone changed this outside the application*, which is exactly what an auditor wants to be able to see.

Audited tables: `organizations`, `projects`, `farms`, `plots`, `strata`, `baseline_control_sites`, `sampling_points`, `users`, `project_memberships`, `agent_action_policies`, `agent_memory`, and inserts on `ghg_parameters`.

Not audited, for reasons: `audit_log` itself would recurse; the append-only evidentiary tables are immutable by construction, so the insert *is* the record; `fertilizers` and `machinery_defaults` are static lookup data.

Payloads strip geometry and embedding columns — a polygon serialised as WKB hex would bloat the log without being readable, and the row itself still holds the current value. `verify.sql` asserts this.

## Why `mcp_tokens` moved to stage 3

An MCP token is scoped to a single work order — that is its entire security model, and the spec is explicit that the contractor's access is limited to one work order and its sampling points. `work_orders` arrives in stage 3.

Creating the table now would mean either a foreign key to a table that does not exist, or no foreign key at all — which would leave nothing preventing an orphan token. Neither is better than waiting one stage.

The **scoping model** the plan asks for does exist: `project_memberships` carries the four roles, the RLS helpers resolve access through the farm, and `agent_action_policies` holds the per-action AUTO/CONFIRM/OFF policy. What is missing is only the token row itself.

## RLS: written, deliberately inert

11 policies exist across the project-scoped tables. RLS is **not enabled** on any of them.

v1 is single-tenant, so enabling it today would gain nothing and could lock the application out on its first day. Writing the policies now means the isolation model was designed while the schema was small; switching on later is `scripts/rls-enable.sql`, one `ALTER` per table.

`verify.sql` asserts both directions — the policies exist **and** RLS is off everywhere — so an accidental enable fails the build just as a missing policy would.

One trap recorded in `rls-enable.sql`: a table's **owner bypasses RLS**. Point the application at the RDS master user and the policies will be active and yet do nothing, which is worse than having none because it looks secure. The application needs its own non-owner role, and must `SET app.user_id` on every connection.

## Outstanding for later

- `mcp_tokens` — stage 3, with work orders.
- Append-only triggers on `samples`, `soc_measurements`, `lab_imports`, `import_quarantine` — those tables arrive in stages 3 and 4; the pattern is established.
- Enabling RLS — needs the application role first, so it belongs with whatever consumes this database.
