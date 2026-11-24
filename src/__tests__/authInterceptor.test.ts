import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../createApiClient";
import { createAuthInterceptor } from "../interceptors/createAuthInterceptor";
import { createMockAdapter, header } from "./helpers";

afterEach(() => vi.restoreAllMocks());

/** Server that accepts only `Bearer <valid>` and answers /refresh. */
const createServer = (valid: () => string) =>
  createMockAdapter((config) => {
    if (config.url === "/refresh") return { data: { accessToken: "new" } };
    return header(config, "Authorization") === `Bearer ${valid()}`
      ? { data: "ok" }
      : { status: 401 };
  });

describe("createAuthInterceptor", () => {
  it("attaches the access token", async () => {
    const { adapter, calls } = createServer(() => "a");
    const api = createApiClient({
      adapter,
      configure: createAuthInterceptor({
        getAccessToken: () => "a",
        refreshTokens: async () => ({ accessToken: "a" }),
      }),
    });

    await expect(api.get("/me")).resolves.toBe("ok");
    expect(header(calls[0], "Authorization")).toBe("Bearer a");
  });

  it("refreshes once for concurrent 401s and retries every request", async () => {
    let token = "old";
    const { adapter } = createServer(() => "new");
    const refreshTokens = vi.fn(async () => ({ accessToken: "new" }));
    const api = createApiClient({
      adapter,
      configure: createAuthInterceptor({
        getAccessToken: () => token,
        refreshTokens,
        setTokens: (t) => {
          token = t.accessToken;
        },
      }),
    });

    const results = await Promise.all([api.get("/a"), api.get("/b"), api.get("/c")]);
    expect(results).toEqual(["ok", "ok", "ok"]);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("does not refresh again for a stale 401 that lands after a refresh finished", async () => {
    let token = "old";
    let refreshToken = "r1";
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((r) => (releaseSlow = r));

    const { adapter } = createMockAdapter(async (config) => {
      // /slow was sent with the old token but its 401 arrives late.
      if (config.url === "/slow" && header(config, "Authorization") === "Bearer old") {
        await slowGate;
      }
      return header(config, "Authorization") === `Bearer ${token}` && token !== "old"
        ? { data: "ok" }
        : { status: 401 };
    });
    // Rotating refresh tokens: each one is single-use.
    const refreshTokens = vi.fn(async (ctx: { refreshToken?: string | null }) => {
      if (ctx.refreshToken !== refreshToken) throw new Error("refresh token reused");
      refreshToken = `r${Number(refreshToken.slice(1)) + 1}`;
      return { accessToken: `new-${refreshToken}`, refreshToken };
    });
    const api = createApiClient({
      adapter,
      configure: createAuthInterceptor({
        getAccessToken: () => token,
        getRefreshToken: () => refreshToken,
        refreshTokens,
        setTokens: (t) => {
          token = t.accessToken;
        },
      }),
    });

    const slow = api.get("/slow");
    await expect(api.get("/fast")).resolves.toBe("ok");
    releaseSlow();
    await expect(slow).resolves.toBe("ok");
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("calls onRefreshFailure and rejects when the refresh fails", async () => {
    const { adapter } = createServer(() => "never");
    const onRefreshFailure = vi.fn();
    const api = createApiClient({
      adapter,
      configure: createAuthInterceptor({
        getAccessToken: () => "old",
        refreshTokens: async () => {
          throw new Error("refresh failed");
        },
        onRefreshFailure,
      }),
    });

    await expect(api.get("/me")).rejects.toThrow("refresh failed");
    expect(onRefreshFailure).toHaveBeenCalledTimes(1);
  });

  it("does not deadlock when the refresh call uses the same client with skipAuth", async () => {
    let token = "old";
    const { adapter, calls } = createServer(() => "new");
    // eslint-disable-next-line prefer-const
    let api: ReturnType<typeof createApiClient>;
    api = createApiClient({
      adapter,
      configure: createAuthInterceptor({
        getAccessToken: () => token,
        refreshTokens: () =>
          api.post<{ accessToken: string }>("/refresh", { skipAuth: true }),
        setTokens: (t) => {
          token = t.accessToken;
        },
      }),
    });

    await expect(api.get("/me")).resolves.toBe("ok");
    const refreshCall = calls.find((c) => c.url === "/refresh")!;
    expect(header(refreshCall, "Authorization")).toBeUndefined();
  });

  it("times out a refresh that never finishes instead of hanging", async () => {
    const { adapter } = createServer(() => "never");
    const api = createApiClient({
      adapter,
      configure: createAuthInterceptor({
        getAccessToken: () => "old",
        refreshTokens: () => new Promise<{ accessToken: string }>(() => {}),
        refreshTimeoutMs: 20,
      }),
    });

    await expect(api.get("/me")).rejects.toThrow(/timed out after 20ms/);
  });

  it("warns and ignores a second registration on the same instance", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let token = "old";
    const { adapter } = createServer(() => "new");
    const refreshTokens = vi.fn(async () => ({ accessToken: "new" }));
    const interceptor = createAuthInterceptor({
      getAccessToken: () => token,
      refreshTokens,
      setTokens: (t) => {
        token = t.accessToken;
      },
    });
    const api = createApiClient({
      adapter,
      configure: (instance) => {
        interceptor(instance);
        interceptor(instance);
      },
    });

    await expect(api.get("/me")).resolves.toBe("ok");
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("more than once"));
  });
});
