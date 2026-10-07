import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f9fa] px-4">
      <div className="text-center">
        <p className="text-sm font-semibold text-primary">404</p>
        <h1 className="mt-2 text-base font-semibold text-[#202124]">
          Page not found
        </h1>
        <p className="mt-1 text-[13px] text-[#5f6368]">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link href="/dashboard">
          <Button variant="outline" size="sm" className="mt-5">
            Back to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
