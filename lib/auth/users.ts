import { getAuthPool } from "@/lib/db/pool";
import type { User } from "./types";

type AuthRow = { id: string; email: string; name: string | null; image: string | null; created_at: Date; last_sign_in_at: Date | null };
function identity(row: AuthRow): User {
  return { id: row.id, email: row.email, name: row.name, image: row.image,
    created_at: row.created_at.toISOString(), last_sign_in_at: row.last_sign_in_at?.toISOString() ?? null,
    user_metadata: { full_name: row.name, name: row.name, avatar_url: row.image } };
}
export async function findAuthUser(id: string): Promise<User | null> {
  const { rows } = await getAuthPool().query<AuthRow>("SELECT id,email,name,image,created_at,last_sign_in_at FROM authn.users WHERE id=$1", [id]);
  return rows[0] ? identity(rows[0]) : null;
}
export async function getAuthUserById(id: string) {
  return { data: { user: await findAuthUser(id) }, error: null };
}
export async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const { rows } = await getAuthPool().query<{ id: string }>("SELECT id FROM authn.users WHERE lower(email)=lower($1)", [email]);
  return rows[0]?.id ?? null;
}
export async function listAuthUsers(page: number, perPage: number, search = "") {
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const db = getAuthPool();
  const [{ rows }, { rows: [count] }] = await Promise.all([
    db.query<AuthRow>("SELECT id,email,name,image,created_at,last_sign_in_at FROM authn.users WHERE email ILIKE $1 ORDER BY created_at,id LIMIT $2 OFFSET $3", [pattern, perPage, (page - 1) * perPage]),
    db.query<{ total: string }>("SELECT count(*) AS total FROM authn.users WHERE email ILIKE $1", [pattern]),
  ]);
  return { users: rows.map(identity), total: Number(count.total) };
}
