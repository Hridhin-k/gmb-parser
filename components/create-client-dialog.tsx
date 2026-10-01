"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";

export function CreateClientDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Client name is required.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, notes: notes.trim() || undefined }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error ?? "Failed to create client.");
        return;
      }

      setOpen(false);
      setName("");
      setNotes("");
      router.refresh();
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus />
            New Client
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Client</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1">
            <label
              htmlFor="client-name"
              className="block text-sm font-medium text-gray-700"
            >
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="client-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kalyan Restaurants"
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-[#18161a] focus:outline-none focus:ring-2 focus:ring-[#18161a]/10"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="client-notes"
              className="block text-sm font-medium text-gray-700"
            >
              Notes
            </label>
            <textarea
              id="client-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about this client"
              rows={3}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-[#18161a] focus:outline-none focus:ring-2 focus:ring-[#18161a]/10"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create Client"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
