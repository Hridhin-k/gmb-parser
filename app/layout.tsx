import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const display = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: "700",
});

export const metadata: Metadata = {
  title: "GRM — Google review management",
  description:
    "Connect the Google account that manages your businesses, then draft, approve, and publish replies in one workspace.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#fafaf8] font-sans text-[#18161a]">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
