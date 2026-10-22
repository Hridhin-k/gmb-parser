import { cache } from "react";
import { resolveTxt } from "node:dns/promises";
import { createAdminClient } from "@/lib/supabase/admin";
import { contactEmailError, createDomainToken, domainError, httpsUrlError } from "@/lib/agency-portal";
import { workspaceGrant } from "@/lib/access";
import { AppError, AuthorizationError, ValidationError } from "@/lib/errors";
import { AuditService } from "@/lib/services/audit";
import { getMemberRole } from "@/lib/services/workspace";

export interface AgencyBranding {
  logoUrl: string | null;
  hideProductName: boolean;
  customDomain: string | null;
  domainToken: string | null;
  domainVerifiedAt: string | null;
  senderEmail: string | null;
}

/** Request-memoised: layout metadata and body both need branding in one render. */
export const loadAgencyBranding = cache(async (workspaceId: string): Promise<AgencyBranding> => {
  const { data } = await createAdminClient()
    .from("grm_agency_branding")
    .select("logo_url, hide_product_name, custom_domain, domain_token, domain_verified_at, sender_email")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return {
    logoUrl: data?.logo_url ?? null,
    hideProductName: data?.hide_product_name ?? false,
    customDomain: data?.custom_domain ?? null,
    domainToken: data?.domain_token ?? null,
    domainVerifiedAt: data?.domain_verified_at ?? null,
    senderEmail: data?.sender_email ?? null,
  };
});

async function assertBrandEditor(userId: string, workspaceId: string): Promise<void> {
  const role = await getMemberRole(userId, workspaceId);
  if (!workspaceGrant(role, "manage_people")) {
    throw new AuthorizationError("You cannot change agency branding.");
  }
}

export async function saveAgencyBranding(input: {
  workspaceId: string;
  userId: string;
  logoUrl: string;
  hideProductName: boolean;
  customDomain: string;
  senderEmail: string;
}): Promise<void> {
  await assertBrandEditor(input.userId, input.workspaceId);
  const logoError = httpsUrlError(input.logoUrl, "Logo");
  if (logoError) throw new ValidationError(logoError);
  const hostError = domainError(input.customDomain);
  if (hostError) throw new ValidationError(hostError);
  const emailError = contactEmailError(input.senderEmail);
  if (emailError) throw new ValidationError(emailError);
  const admin = createAdminClient();
  const existing = await loadAgencyBranding(input.workspaceId);
  const domain = input.customDomain.trim().toLowerCase() || null;
  const domainChanged = domain !== existing.customDomain;
  const { error } = await admin.from("grm_agency_branding").upsert({
    workspace_id: input.workspaceId,
    logo_url: input.logoUrl.trim() || null,
    hide_product_name: input.hideProductName,
    custom_domain: domain,
    domain_token: domain ? (domainChanged ? createDomainToken() : existing.domainToken ?? createDomainToken()) : null,
    domain_verified_at: domainChanged ? null : existing.domainVerifiedAt,
    sender_email: input.senderEmail.trim() || null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new AppError("Could not save branding.", "DB_ERROR", 500);
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "branding.updated",
    entityType: "grm_agency_branding",
    entityId: input.workspaceId,
  });
}

export async function verifyAgencyDomain(workspaceId: string, userId: string): Promise<{ matched: boolean }> {
  await assertBrandEditor(userId, workspaceId);
  const branding = await loadAgencyBranding(workspaceId);
  if (!branding.customDomain || !branding.domainToken) {
    throw new ValidationError("Save a domain before checking DNS.");
  }
  const names = [branding.customDomain, `_revupilot.${branding.customDomain}`];
  let matched = false;
  for (const name of names) {
    try {
      const records = await resolveTxt(name);
      if (records.some((parts) => parts.join("").includes(branding.domainToken!))) {
        matched = true;
        break;
      }
    } catch {
      matched = false;
    }
  }
  if (matched) {
    await createAdminClient()
      .from("grm_agency_branding")
      .update({ domain_verified_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId);
  }
  return { matched };
}
