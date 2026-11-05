"use client";

import { useState } from "react";
import { ResolutionContactForm } from "@/components/resolution-contact-form";
import { SelectField } from "@/components/ui/select-field";
import { resolvedContact, type ResolutionContact } from "@/lib/resolution-contact";

export function StoreResolutionContacts({ contact, canEditDefault, stores }: {
  contact: ResolutionContact;
  canEditDefault: boolean;
  stores: Array<{ id: string; name: string; contact: ResolutionContact; canEdit: boolean }>;
}) {
  const [selected, setSelected] = useState("default");
  const store = stores.find((item) => item.id === selected);
  const effective = store ? resolvedContact(store.contact, contact) : contact;
  const inherited = store && !store.contact.phone && !store.contact.email;
  return (
    <section id="resolution-contacts" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">Customer contact details</h2>
        <p className="mt-1 text-[13px] text-ink-3">Choose a store to save its manager or customer care contact. Each review uses the contact for its own store.</p>
      </div>
      <div className="max-w-2xl">
        <SelectField label="Contact for" value={selected} onValueChange={setSelected} options={[
          { value: "default", label: "Default for stores without their own contact" },
          ...stores.map((item) => ({ value: item.id, label: item.name })),
        ]} />
      </div>
      <p className="text-[13px] text-ink-2" role="status">
        {inherited ? "Using default: " : "Available for replies: "}
        {[effective.phone, effective.email].filter(Boolean).join(" · ") || "No phone or email saved"}
      </p>
      <ResolutionContactForm key={`${selected}:${store?.contact.phone ?? contact.phone}:${store?.contact.email ?? contact.email}`}
        contact={store?.contact ?? contact} canEdit={store ? store.canEdit : canEditDefault} locationId={store?.id} />
    </section>
  );
}
