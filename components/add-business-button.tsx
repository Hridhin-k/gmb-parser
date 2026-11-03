"use client";

import { useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { AgencyClientForm } from "@/components/agency-client-form";

/** "Add business" on Locations: a dialog with the business form, which opens the new business when saved. */
export function AddBusinessButton({ managers, canAssignManager }: { managers: Array<{ id: string; email: string }>; canAssignManager: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger className="inline-flex h-10 items-center rounded-full bg-ink px-[18px] text-sm font-semibold text-white outline-none hover:bg-ink-2 focus-visible:ring-2 focus-visible:ring-brand-line">
        Add business
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-ink/45 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-5 shadow-overlay outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
          <DialogPrimitive.Title className="text-base font-semibold leading-snug text-ink">Add a business</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 mb-4 text-[13px] leading-relaxed text-ink-3">
            Businesses hold Google locations. After adding one, assign its locations or send the owner a connection link.
          </DialogPrimitive.Description>
          <AgencyClientForm clientId={null} canAssignManager={canAssignManager} managers={managers} onCancel={() => setOpen(false)} />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
