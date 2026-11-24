import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createApiClient } from "../createApiClient";

afterEach(() => vi.unstubAllGlobals());

// Streams go through Axios' fetch adapter, which builds a Request; Node's
// Request can't parse relative URLs, so every client gets an absolute baseURL.
const BASE = "https://api.test";

const encoder = new TextEncoder();

/** A streaming Response whose chunks the test pushes by hand. */
const controllableStream = () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    { status: 200 }
  );
  return {
    response,
    push: (chunk: string) => controller.enqueue(encoder.encode(chunk)),
    close: () => controller.close(),
  };
};

/** fetch that never answers and rejects once its signal aborts. */
const hangingFetch = () =>
  vi.fn(
    (request: Request) =>
      new Promise<Response>((_, reject) => {
        request.signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError"))
        );
      })
  );

describe("client.useStream", () => {
  it("accumulates chunks and finishes", async () => {
    const s = controllableStream();
    vi.stubGlobal("fetch", vi.fn(async () => s.response));
    const api = createApiClient({ baseURL: BASE });
    const onComplete = vi.fn();

    const { result } = renderHook(() =>
      api.useStream({ url: "/chat", method: "POST", onComplete })
    );

    await act(async () => {
      await result.current.start({ prompt: "hi" });
    });
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      s.push("Hel");
      s.push("lo");
      s.close();
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.data).toBe("Hello");
    expect(result.current.isLoading).toBe(false);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("keeps start stable when the config is an inline object", () => {
    const api = createApiClient({ baseURL: BASE });
    const { result, rerender } = renderHook(() =>
      api.useStream({ url: "/chat" })
    );

    const first = result.current.start;
    rerender();
    expect(result.current.start).toBe(first);
  });

  it("uses the latest config when start runs", async () => {
    const fetchMock = vi.fn(async (_request: Request) => controllableStream().response);
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseURL: BASE });

    const { result, rerender } = renderHook(({ url }) => api.useStream({ url }), {
      initialProps: { url: "/one" },
    });
    rerender({ url: "/two" });

    await act(async () => {
      await result.current.start();
    });
    expect(fetchMock.mock.calls[0][0].url).toBe(`${BASE}/two`);
  });

  it("does not let a replaced stream overwrite the new one", async () => {
    const first = controllableStream();
    const second = controllableStream();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response)
    );
    const api = createApiClient({ baseURL: BASE });
    const { result } = renderHook(() => api.useStream({ url: "/chat" }));

    await act(async () => {
      await result.current.start();
    });
    act(() => first.push("old"));
    await waitFor(() => expect(result.current.data).toBe("old"));

    await act(async () => {
      await result.current.start();
    });
    act(() => second.push("new"));

    await waitFor(() => expect(result.current.data).toBe("new"));
    // The first stream was aborted and completed, but must not end this one.
    expect(result.current.isStreaming).toBe(true);
  });

  it("aborts while still connecting", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseURL: BASE });
    const { result } = renderHook(() => api.useStream({ url: "/chat" }));

    let started!: Promise<unknown>;
    act(() => {
      started = result.current.start();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    act(() => result.current.abort());

    await expect(started).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock.mock.calls[0][0].signal.aborted).toBe(true);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("aborts when the component unmounts", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseURL: BASE });
    const { result, unmount } = renderHook(() => api.useStream({ url: "/chat" }));

    let started!: Promise<unknown>;
    act(() => {
      started = result.current.start();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    unmount();
    await expect(started).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it("honours a signal passed in the config", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseURL: BASE });
    const own = new AbortController();
    const { result } = renderHook(() =>
      api.useStream({ url: "/chat", signal: own.signal })
    );

    let started!: Promise<unknown>;
    act(() => {
      started = result.current.start();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    own.abort();
    await expect(started).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports request errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const api = createApiClient({ baseURL: BASE });
    const onError = vi.fn();
    const { result } = renderHook(() => api.useStream({ url: "/chat", onError }));

    await act(async () => {
      await result.current.start().catch(() => {});
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.isStreaming).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
