import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared failure screen for route error boundaries.
 * `screen` fills the viewport. `section` sits inside the app shell.
 */
export function ErrorState({
  title,
  message,
  digest,
  onRetry,
  layout,
}: {
  title: string;
  message: string;
  digest?: string;
  onRetry: () => void;
  layout: "screen" | "section";
}) {
  const screen = layout === "screen";
  const Heading = screen ? "h1" : "h2";
  const body = (
    <>
      <div
        className={
          screen
            ? "mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-bad-tint"
            : "flex h-10 w-10 items-center justify-center rounded-full bg-bad-tint"
        }
      >
        <AlertTriangle className={screen ? "h-6 w-6 text-bad" : "h-5 w-5 text-bad"} aria-hidden />
      </div>
      <Heading
        className={
          screen
            ? "mt-4 text-[15px] font-semibold text-bad"
            : "mt-3 text-[15px] font-semibold text-bad"
        }
      >
        {title}
      </Heading>
      <p className="mt-1 max-w-sm text-[13px] text-ink-3">{message}</p>
      {digest ? (
        <p className="mt-2 font-mono text-[11px] text-ink-3">Reference: {digest}</p>
      ) : null}
      <Button
        variant="default"
        size={screen ? "default" : "sm"}
        className={screen ? "mt-5" : "mt-4"}
        onClick={onRetry}
      >
        Try again
      </Button>
    </>
  );

  if (screen) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="text-center">{body}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">{body}</div>
  );
}
