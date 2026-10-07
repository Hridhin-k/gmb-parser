"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Unplug } from "lucide-react";

interface ConnectionInfo {
  id: string;
  google_email: string;
  status: string;
  created_at: string;
  last_refreshed_at: string | null;
}

interface GoogleConnectionCardProps {
  connections: ConnectionInfo[];
  initialMessage?: string | null;
  initialSuccess?: boolean;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge variant="default" className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50">Connected</Badge>;
    case "expired":
      return <Badge variant="default" className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50">Expired</Badge>;
    case "revoked":
      return <Badge variant="default" className="bg-red-50 text-red-700 border-red-200 hover:bg-red-50">Revoked</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function GoogleConnectionCard({
  connections,
  initialMessage,
  initialSuccess,
}: GoogleConnectionCardProps) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(initialMessage ?? null);
  const [success, setSuccess] = useState(initialSuccess ?? false);

  const activeConnections = connections.filter((c) => c.status !== "revoked");

  async function handleDisconnect(connectionId: string) {
    setDisconnecting(connectionId);
    setError(null);

    try {
      const response = await fetch("/api/google/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to disconnect");
      }

      toast.success("Google account disconnected");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setDisconnecting(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle
            className="text-[22px] leading-[1.3] tracking-[-0.02em] text-[#202124]"
            style={{ fontFamily: "var(--font-google-sans-display), sans-serif" }}
          >
            Google Business Profile
          </CardTitle>
          <p className="mt-1 text-sm font-light text-[#5f6368]">
            Connect your Google account to manage reviews. Sync pulls the newest pages only unless you rebuild.
          </p>
        </div>
        <a
          href="/api/google/connect"
          onClick={() => {
            setError(null);
            setSuccess(false);
          }}
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#1a73e8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1967d2]"
        >
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
          Connect Google
        </a>
      </CardHeader>

      <CardContent className="space-y-3">
        {success && (
          <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 border border-emerald-200">
            Google Business Profile connected successfully.
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-200">
            {error}
          </div>
        )}

        {activeConnections.length === 0 && !error && !success && (
          <p className="py-2 text-sm font-light text-[#5f6368]">
            No Google accounts connected. Click &ldquo;Connect Google&rdquo; to
            get started.
          </p>
        )}

        {activeConnections.map((conn) => (
          <div
            key={conn.id}
            className="flex flex-col gap-3 rounded-[12px] border border-[#dadce0] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-center gap-3">
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#202124]">
                  {conn.google_email}
                </p>
                <p className="text-xs font-light text-[#5f6368]">
                  Connected{" "}
                  {new Date(conn.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              {getStatusBadge(conn.status)}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={disconnecting === conn.id}
              onClick={() => setConfirmTarget({ id: conn.id, email: conn.google_email })}
              className="text-[#3c4043]"
            >
              <Unplug className="mr-1.5 h-3.5 w-3.5" />
              {disconnecting === conn.id ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        ))}
      </CardContent>
      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
        title="Disconnect this Google account?"
        description={
          <>
            GRM stops syncing reviews and publishing replies for{" "}
            <span className="font-medium text-[#202124]">{confirmTarget?.email}</span>. Reviews
            already synced stay in GRM. You can reconnect at any time.
          </>
        }
        confirmLabel="Disconnect"
        pendingLabel="Disconnecting…"
        tone="danger"
        onConfirm={async () => {
          if (confirmTarget) await handleDisconnect(confirmTarget.id);
        }}
      />
    </Card>
  );
}
