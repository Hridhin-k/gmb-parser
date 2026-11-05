import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncGoogleConnections } from "@/lib/google-profile-sync-client";

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
const response = (ok: boolean, body: unknown) => ({ ok, json: async () => body });

describe("multi Google account profile sync", () => {
  it("syncs every distinct account and keeps successful results after an account fails", async () => {
    fetchMock.mockResolvedValueOnce(response(false, { error: "Reconnect account A" }))
      .mockResolvedValueOnce(response(true, { locationsUpserted: 4 }))
      .mockResolvedValueOnce(response(true, { skippedGoogleFetch: true }));
    const progress = vi.fn();
    const results = await syncGoogleConnections(["a", "b", "a", "c"], { stage: true }, progress);
    expect(results).toEqual([
      { connectionId: "a", error: "Reconnect account A" },
      { connectionId: "b", locationsUpserted: 4 },
      { connectionId: "c", skippedGoogleFetch: true },
    ]);
    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1].body))).toEqual([
      { connectionId: "a", stage: true }, { connectionId: "b", stage: true }, { connectionId: "c", stage: true },
    ]);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });
  it("continues after a timeout, network failure or malformed response without retrying writes", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network failure"))
      .mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("not JSON"); } })
      .mockResolvedValueOnce(response(true, { locationsUpserted: 2 }));
    const results = await syncGoogleConnections(["a", "b", "c"]);
    expect(results.slice(0, 2).every((item) => Boolean(item.error))).toBe(true);
    expect(results[2]).toMatchObject({ connectionId: "c", locationsUpserted: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("makes no request for an empty account selection", async () => {
    expect(await syncGoogleConnections([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
