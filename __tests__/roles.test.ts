import { describe, expect, it } from "vitest";
import { canManageMember, roleLabel } from "@/lib/roles";

describe("canManageMember", () => {
  it("never allows managing an owner", () => {
    expect(canManageMember("owner", "owner")).toBe(false);
    expect(canManageMember("admin", "owner")).toBe(false);
    expect(canManageMember("member", "owner")).toBe(false);
  });

  it("lets an owner manage admins and members", () => {
    expect(canManageMember("owner", "admin")).toBe(true);
    expect(canManageMember("owner", "member")).toBe(true);
  });

  it("lets an admin manage members only", () => {
    expect(canManageMember("admin", "member")).toBe(true);
    expect(canManageMember("admin", "admin")).toBe(false);
  });

  it("gives members and unknown roles no management rights", () => {
    expect(canManageMember("member", "member")).toBe(false);
    expect(canManageMember(null, "member")).toBe(false);
    expect(canManageMember(undefined, "admin")).toBe(false);
  });
});

describe("roleLabel", () => {
  it("labels each role", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("member")).toBe("Member");
  });
});
