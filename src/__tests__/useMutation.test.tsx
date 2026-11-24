import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createApiClient } from "../createApiClient";
import { createMockAdapter, createWrapper } from "./helpers";

const parse = (data: unknown) =>
  typeof data === "string" ? JSON.parse(data) : data;

describe("client.useMutation", () => {
  it("sends variables as the body and keeps callbacks out of the request", async () => {
    const { adapter, calls } = createMockAdapter(() => ({ data: { id: 1 } }));
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();
    const onError = vi.fn();

    const { result } = renderHook(
      () => api.useMutation<{ id: number }, unknown, { title: string }>({
        url: "/todos",
        onError,
      }),
      { wrapper }
    );

    await act(() => result.current.mutateAsync({ title: "Buy milk" }));
    expect(calls[0].method).toBe("post");
    expect(parse(calls[0].data)).toEqual({ title: "Buy milk" });
    expect(calls[0]).not.toHaveProperty("onError");
  });

  it("builds the URL from variables", async () => {
    const { adapter, calls } = createMockAdapter(() => ({ data: null }));
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => api.useMutation<null, unknown, { id: number; done: boolean }>({
        url: ({ id }) => `/todos/${id}`,
        method: "PATCH",
      }),
      { wrapper }
    );

    await act(() => result.current.mutateAsync({ id: 7, done: true }));
    expect(calls[0].url).toBe("/todos/7");
    expect(parse(calls[0].data)).toEqual({ id: 7, done: true });
  });

  it("never sends variables as the body of a GET", async () => {
    const { adapter, calls } = createMockAdapter(() => ({ data: null }));
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => api.useMutation<null, unknown, number>({
        url: (id) => `/todos/${id}`,
        method: "GET",
      }),
      { wrapper }
    );

    await act(() => result.current.mutateAsync(3));
    expect(calls[0].data).toBeUndefined();
  });

  it("still sends variables as the body of a DELETE, as in 0.3.x", async () => {
    const { adapter, calls } = createMockAdapter(() => ({ data: null }));
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => api.useMutation<null, unknown, { ids: number[] }>({
        url: "/todos",
        method: "DELETE",
      }),
      { wrapper }
    );

    await act(() => result.current.mutateAsync({ ids: [1, 2] }));
    expect(parse(calls[0].data)).toEqual({ ids: [1, 2] });
  });

  it("uses the body option to build the request body", async () => {
    const { adapter, calls } = createMockAdapter(() => ({ data: null }));
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => api.useMutation<null, unknown, { id: number; title: string }>({
        url: ({ id }) => `/todos/${id}`,
        method: "PUT",
        body: ({ title }) => ({ title }),
      }),
      { wrapper }
    );

    await act(() => result.current.mutateAsync({ id: 1, title: "x" }));
    expect(parse(calls[0].data)).toEqual({ title: "x" });
  });

  it("calls onSuccess and invalidates matching queries, including ones with params", async () => {
    let version = 0;
    const { adapter } = createMockAdapter((config) =>
      config.method === "get" ? { data: `v${version}` } : { data: (version += 1) }
    );
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () => ({
        list: api.useQuery({ key: "todos", url: "/todos", params: { page: 1 } }),
        create: api.useMutation<number, unknown, { title: string }>({
          url: "/todos",
          keyToInvalidate: "todos",
          onSuccess,
        }),
      }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.list.data).toBe("v0"));
    await act(() => result.current.create.mutateAsync({ title: "x" }));

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][0]).toBe(1);
    expect(onSuccess.mock.calls[0][1]).toEqual({ title: "x" });
    await waitFor(() => expect(result.current.list.data).toBe("v1"));
  });
});

describe("client.useMutation keyToInvalidate function", () => {
  it("builds the keys from the response and the variables", async () => {
    const { adapter } = createMockAdapter((config) =>
      config.method === "get"
        ? { data: config.url }
        : { data: { id: 7, listId: "inbox" } }
    );
    const api = createApiClient({ adapter });
    const { wrapper, queryClient } = createWrapper();
    const builder = vi.fn(
      (todo: { id: number; listId: string }, vars: { id: number }) => [
        ["todos", vars.id],
        ["lists", todo.listId],
      ]
    );

    const { result } = renderHook(
      () => ({
        seven: api.useQuery({ key: ["todos", 7], url: "/todos/7" }),
        eight: api.useQuery({ key: ["todos", 8], url: "/todos/8" }),
        update: api.useMutation<
          { id: number; listId: string },
          unknown,
          { id: number }
        >({
          url: ({ id }) => `/todos/${id}`,
          method: "PATCH",
          keyToInvalidate: builder,
        }),
      }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.eight.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.seven.isSuccess).toBe(true));
    await act(() => result.current.update.mutateAsync({ id: 7 }));

    expect(builder).toHaveBeenCalledWith({ id: 7, listId: "inbox" }, { id: 7 });
    expect(queryClient.getQueryState(["todos", 7])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(["todos", 8])?.isInvalidated).toBe(false);
    // ["todos", 7] was refetched; ["todos", 8] was never invalidated.
    expect(queryClient.getQueryState(["todos", 7])?.dataUpdateCount).toBe(2);
    expect(queryClient.getQueryState(["todos", 8])?.dataUpdateCount).toBe(1);
  });

  it("invalidates nothing when the function returns undefined", async () => {
    const { adapter, calls } = createMockAdapter(() => ({ data: "ok" }));
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => ({
        list: api.useQuery({ key: "todos", url: "/todos" }),
        create: api.useMutation<string, unknown, void>({
          url: "/todos",
          keyToInvalidate: () => undefined,
        }),
      }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    await act(() => result.current.create.mutateAsync());
    expect(calls.filter((c) => c.method === "get")).toHaveLength(1);
  });
});
