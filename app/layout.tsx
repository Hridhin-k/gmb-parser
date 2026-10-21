import type { Metadata } from "next";
import { Cal_Sans, Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const calSans = Cal_Sans({
  variable: "--font-cal-sans",
  subsets: ["latin"],
  weight: "400",
  // Cal Sans is missing from Next's capsize metrics, so automatic
  // size-adjust fallback always warns. A manual stack skips that lookup.
  adjustFontFallback: false,
  fallback: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "RevuPilot — Google review management",
  description:
    "Connect the Google account that manages your businesses, then draft, approve, and publish replies in one workspace.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${calSans.variable} h-full antialiased`}>
      <body className="min-h-full bg-paper font-sans text-graphite">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
