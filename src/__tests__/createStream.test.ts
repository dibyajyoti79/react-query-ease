import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../createApiClient";
import { createAuthInterceptor } from "../interceptors/createAuthInterceptor";

afterEach(() => vi.unstubAllGlobals());

const encoder = new TextEncoder();

const streamResponse = (chunks: string[], keepOpen = false) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
        if (!keepOpen) controller.close();
      },
    }),
    { status: 200 }
  );

const collect = async (iterable: AsyncIterable<string>) => {
  const out: string[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
};

describe("client.stream", () => {
  it("yields chunks and calls onChunk and onComplete", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse(["Hel", "lo"])));
    const api = createApiClient({ baseURL: "https://api.test" });
    const onChunk = vi.fn();
    const onComplete = vi.fn();

    const stream = await api.stream({ url: "/chat", onChunk, onComplete });
    expect((await collect(stream)).join("")).toBe("Hello");
    expect(onChunk).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://api.test/chat");
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    let token = "old";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer new"
        ? streamResponse(["ok"])
        : new Response(null, { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const refreshTokens = vi.fn(async () => ({ accessToken: "new" }));
    const api = createApiClient({
      configure: createAuthInterceptor({
        getAccessToken: () => token,
        refreshTokens,
        setTokens: (t) => {
          token = t.accessToken;
        },
      }),
    });

    const stream = await api.stream({ url: "/chat" });
    expect(await collect(stream)).toEqual(["ok"]);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends no token when skipAuth is set", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      streamResponse(["ok"])
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({
      configure: createAuthInterceptor({
        getAccessToken: () => "a",
        refreshTokens: async () => ({ accessToken: "a" }),
      }),
    });

    await collect(await api.stream({ url: "/public", skipAuth: true }));
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("ends the iterator when aborted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse(["first"], true)));
    const api = createApiClient();

    const stream = await api.stream({ url: "/chat" });
    const iterator = stream[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: "first", done: false });

    stream.abort();
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });
});
