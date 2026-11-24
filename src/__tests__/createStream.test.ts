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
    expect((vi.mocked(fetch).mock.calls[0][0] as Request).url).toBe(
      "https://api.test/chat"
    );
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    let token = "old";
    const fetchMock = vi.fn(async (request: Request) => {
      const auth = request.headers.get("Authorization");
      return auth === "Bearer new"
        ? streamResponse(["ok"])
        : new Response(null, { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const refreshTokens = vi.fn(async () => ({ accessToken: "new" }));
    const api = createApiClient({
      baseURL: "https://api.test",
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
    const fetchMock = vi.fn(async (_request: Request) => streamResponse(["ok"]));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({
      baseURL: "https://api.test",
      configure: createAuthInterceptor({
        getAccessToken: () => "a",
        refreshTokens: async () => ({ accessToken: "a" }),
      }),
    });

    await collect(await api.stream({ url: "/public", skipAuth: true }));
    expect(fetchMock.mock.calls[0][0].headers.has("Authorization")).toBe(false);
  });

  it("ends the iterator when aborted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse(["first"], true)));
    const api = createApiClient({ baseURL: "https://api.test" });

    const stream = await api.stream({ url: "/chat" });
    const iterator = stream[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: "first", done: false });

    stream.abort();
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });
});

const okFetch = () => {
  const fetchMock = vi.fn(async (_request: Request) => streamResponse(["ok"]));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("client.stream goes through the Axios instance", () => {
  it("serializes a JSON body and sets Content-Type", async () => {
    const fetchMock = okFetch();
    const api = createApiClient({ baseURL: "https://api.test" });

    await collect(await api.stream({ url: "/chat", method: "POST", data: { prompt: "hi" } }));
    const request = fetchMock.mock.calls[0][0];
    expect(request.method).toBe("POST");
    expect(request.headers.get("Content-Type")).toMatch(/application\/json/);
    expect(await request.text()).toBe('{"prompt":"hi"}');
  });

  it("applies default headers and custom interceptors from configure", async () => {
    const fetchMock = okFetch();
    const api = createApiClient({
      baseURL: "https://api.test",
      headers: { "X-App": "web" },
      configure: (instance) => {
        instance.interceptors.request.use((config) => {
          config.headers.set("X-Trace", "abc");
          return config;
        });
      },
    });

    await collect(await api.stream({ url: "/chat" }));
    const request = fetchMock.mock.calls[0][0];
    expect(request.headers.get("X-App")).toBe("web");
    expect(request.headers.get("X-Trace")).toBe("abc");
  });

  it("sends the XSRF cookie as a header to the same origin", async () => {
    const fetchMock = okFetch();
    document.cookie = "XSRF-TOKEN=csrf123";
    const api = createApiClient({ baseURL: location.origin });

    await collect(await api.stream({ url: "/chat", method: "POST", data: {} }));
    expect(fetchMock.mock.calls[0][0].headers.get("X-XSRF-TOKEN")).toBe("csrf123");
    document.cookie = "XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("passes credentials through to fetch", async () => {
    const fetchMock = okFetch();
    const api = createApiClient({ baseURL: "https://api.test" });

    await collect(await api.stream({ url: "/chat", credentials: "include" }));
    expect(fetchMock.mock.calls[0][0].credentials).toBe("include");
  });

  it("rejects with an AxiosError that carries the status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const api = createApiClient({ baseURL: "https://api.test" });

    await expect(api.stream({ url: "/chat" })).rejects.toMatchObject({
      isAxiosError: true,
      response: { status: 500 },
    });
  });
});
