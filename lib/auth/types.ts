/** Domain identity, independent of an authentication vendor. */
export interface User {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  created_at: string;
  last_sign_in_at?: string | null;
  user_metadata: { full_name?: string | null; name?: string | null; avatar_url?: string | null };
}
