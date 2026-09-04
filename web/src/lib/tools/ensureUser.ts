import "server-only";
import { audit, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

/**
 * Give the signed-in identity a row in mrv.users, and a role on the project.
 *
 * Nothing downstream can be written without this. mrv.work_orders carries
 * wo_issued_chk — a work order that has left 'draft' must record issued_by
 * and issued_at — and issued_by is a foreign key into mrv.users. So an empty
 * users table does not merely lose an audit detail; it makes issuing a work
 * order impossible.
 *
 * Google is the authority on who the person is: the domain restriction in
 * src/auth.ts already guarantees a verified @carbonature.io address before
 * this runs. What is recorded here is what the MRV schema needs on top of
 * that — an org, a role on the project, and a stable user_id for the
 * foreign keys.
 *
 * It is an upsert rather than an insert because it runs on every sign-in.
 * The email is citext and UNIQUE, so a change of capitalisation or display
 * name updates the same person rather than creating a second one.
 */
export async function ensureUser(
  ctx: ToolContext,
  profile: { email: string; fullName?: string | null },
): Promise<ToolResult<{ userId: string; created: boolean; role: string }>> {
  const guard = requireDbMode("ensureUser");
  if (guard) return guard;

  const email = profile.email?.trim().toLowerCase();
  if (!email) return fail("ensureUser: no email on the signed-in identity.");

  const { query } = await import("../db");

  // The org the project belongs to, so a user is never created against a
  // guessed organisation. If there is no project there is nothing to grant a
  // role on, and creating a floating user would be worse than refusing.
  const orgRows = await query<{ org_id: string; project_id: string }>(
    `SELECT org_id, project_id FROM mrv.projects ORDER BY project_id LIMIT 1`,
  );
  if (!orgRows.length) {
    return fail("ensureUser: there is no project in the database to attach a user to.");
  }
  const { org_id: orgId, project_id: projectId } = orgRows[0];

  const existing = await query<{ user_id: string }>(
    `SELECT user_id FROM mrv.users WHERE email = $1`,
    [email],
  );

  let userId: string;
  let created = false;

  if (existing.length) {
    userId = existing[0].user_id;
    await query(
      `UPDATE mrv.users
          SET full_name      = coalesce(nullif($2, ''), full_name),
              last_active_at = clock_timestamp(),
              updated_at     = clock_timestamp(),
              seen_apps      = array(SELECT DISTINCT unnest(seen_apps || ARRAY['mrv']))
        WHERE user_id = $1`,
      [userId, profile.fullName ?? ""],
    );
  } else {
    const inserted = await query<{ user_id: string }>(
      `INSERT INTO mrv.users (org_id, email, full_name, auth_method, last_active_at, seen_apps)
       VALUES ($1, $2, $3, 'sso', clock_timestamp(), ARRAY['mrv'])
       RETURNING user_id`,
      [orgId, email, profile.fullName?.trim() || email],
    );
    userId = inserted[0].user_id;
    created = true;
  }

  // The first person in gets super_admin — somebody has to be able to grant
  // the others, and there is no one yet to do the granting. Everyone after
  // that starts as mrv_manager, which can run the chain but not change who
  // else may.
  const roleRows = await query<{ role: string }>(
    `SELECT role::text FROM mrv.project_memberships WHERE user_id = $1 AND project_id = $2`,
    [userId, projectId],
  );

  let role: string;
  if (roleRows.length) {
    role = roleRows[0].role;
  } else {
    const anyMember = await query<{ n: string }>(
      `SELECT count(*)::text n FROM mrv.project_memberships WHERE project_id = $1`,
      [projectId],
    );
    role = Number(anyMember[0].n) === 0 ? "super_admin" : "mrv_manager";
    await query(
      `INSERT INTO mrv.project_memberships (user_id, project_id, role)
       VALUES ($1, $2, $3::mrv.app_role)
       ON CONFLICT (user_id, project_id) DO NOTHING`,
      [userId, projectId, role],
    );
    await audit({ ...ctx, userId }, "grant_project_role", { type: "user", id: userId }, {
      projectId,
      role,
      reason: role === "super_admin" ? "first member of the project" : "default for a new member",
    });
  }

  if (created) {
    await audit({ ...ctx, userId }, "create_user", { type: "user", id: userId }, {
      email,
      authMethod: "sso",
    });
  }

  return ok({ userId, created, role });
}
