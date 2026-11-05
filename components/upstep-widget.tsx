"use client";

import { FeedbackWidget, UpstepProvider } from "@upstep/js/react";

export function UpstepWidget({ userId }: { userId: string }) {
  return (
    <UpstepProvider
      // Publishable SDK key; dashboard/MCP credentials stay outside the browser.
      apiKey="upstep_pk_ORGOGO9fHP55AUQQ9hI21kUBpsQyiyU9"
      baseUrl="https://upstep.dev"
      userId={userId}
      accentColor="#1f4ed8"
      theme="light"
    >
      <FeedbackWidget />
    </UpstepProvider>
  );
}
