import { createClient } from "@/lib/supabase/server";
import { LandingPage } from "@/components/landing-page";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <LandingPage signedIn={Boolean(user)} />;
}
