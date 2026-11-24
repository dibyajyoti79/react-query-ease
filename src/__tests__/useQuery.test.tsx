import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createApiClient } from "../createApiClient";
import { createMockAdapter, createWrapper, header, waitForAbort } from "./helpers";

describe("client.useQuery", () => {
  it("sends Axios options and keeps React Query options out of the request", async () => {
    const { adapter, calls } = createMockAdapter(() => ({ data: [1] }));
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        api.useQuery<number[]>({
          key: "todos",
          url: "/todos",
          headers: { "X-Test": "yes" },
          staleTime: 5000,
          select: (d) => d,
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([1]);
    expect(header(calls[0], "X-Test")).toBe("yes");
    expect(calls[0]).not.toHaveProperty("staleTime");
    expect(calls[0]).not.toHaveProperty("select");
  });

  it("keeps the bare key when no params are given", async () => {
    const { adapter } = createMockAdapter(() => ({ data: "ok" }));
    const api = createApiClient({ adapter });
    const { wrapper, queryClient } = createWrapper();

    const { result } = renderHook(
      () => api.useQuery({ key: ["todos"], url: "/todos" }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(["todos"])).toBe("ok");
  });

  it("gives each set of params its own cache entry", async () => {
    const { adapter, calls } = createMockAdapter((config) => ({
      data: `page-${config.params.page}`,
    }));
    const api = createApiClient({ adapter });
    const { wrapper, queryClient } = createWrapper();

    const { result, rerender } = renderHook(
      ({ page }) => api.useQuery({ key: "todos", url: "/todos", params: { page } }),
      { wrapper, initialProps: { page: 1 } }
    );
    await waitFor(() => expect(result.current.data).toBe("page-1"));

    rerender({ page: 2 });
    await waitFor(() => expect(result.current.data).toBe("page-2"));

    expect(calls).toHaveLength(2);
    expect(queryClient.getQueryData(["todos", { page: 1 }])).toBe("page-1");
    expect(queryClient.getQueryData(["todos", { page: 2 }])).toBe("page-2");
  });

  it("uses the bare key when paramsInKey is false on the client", async () => {
    const { adapter } = createMockAdapter(() => ({ data: "ok" }));
    const api = createApiClient({ adapter, paramsInKey: false });
    const { wrapper, queryClient } = createWrapper();

    const { result } = renderHook(
      () => api.useQuery({ key: "todos", url: "/todos", params: { page: 1 } }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(["todos"])).toBe("ok");
  });

  it("lets a single query override paramsInKey", async () => {
    const { adapter } = createMockAdapter(() => ({ data: "ok" }));
    const api = createApiClient({ adapter });
    const { wrapper, queryClient } = createWrapper();

    const { result } = renderHook(
      () =>
        api.useQuery({
          key: "todos",
          url: "/todos",
          params: { page: 1 },
          paramsInKey: false,
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(["todos"])).toBe("ok");
  });

  it("aborts the request when the component unmounts", async () => {
    const { adapter, calls } = createMockAdapter(waitForAbort);
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();

    const { unmount } = renderHook(
      () => api.useQuery({ key: "slow", url: "/slow" }),
      { wrapper }
    );
    await waitFor(() => expect(calls).toHaveLength(1));

    const signal = calls[0].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    await waitFor(() => expect(signal.aborted).toBe(true));
  });

  it("does not pass a signal when cancelable is false", async () => {
    const { adapter, calls } = createMockAdapter(() => ({ data: "ok" }));
    const api = createApiClient({ adapter, cancelable: false });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => api.useQuery({ key: "todos", url: "/todos" }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].signal).toBeUndefined();
  });

  it("prefers a signal passed by the caller", async () => {
    const { adapter, calls } = createMockAdapter(() => ({ data: "ok" }));
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();
    const own = new AbortController();

    const { result } = renderHook(
      () => api.useQuery({ key: "todos", url: "/todos", signal: own.signal }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].signal).toBe(own.signal);
  });

  it("applies the axios escape hatch last", async () => {
    const { adapter, calls } = createMockAdapter(() => ({ data: "ok" }));
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        api.useQuery({
          key: "todos",
          url: "/todos",
          timeout: 10,
          axios: { timeout: 99 },
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].timeout).toBe(99);
  });
});
