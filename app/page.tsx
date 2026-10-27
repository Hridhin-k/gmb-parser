import { getCurrentUser } from "@/lib/auth/server";
import { LandingPage } from "@/components/landing-page";

export default async function Home() {
  const user = await getCurrentUser();

  return <LandingPage signedIn={Boolean(user)} />;
}
