import React, { Suspense } from "react";
import { describe, expect, expectTypeOf, it } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import {
  HydrationBoundary,
  QueryClientProvider,
  dehydrate,
  useQueries,
  useQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createApiClient } from "../createApiClient";
import { createMockAdapter, createWrapper } from "./helpers";

type Todo = { id: number; title: string };

describe("client.queryOptions", () => {
  it("builds the same key useQuery uses, params included", () => {
    const api = createApiClient();
    const options = api.queryOptions<Todo[]>({
      key: "todos",
      url: "/todos",
      params: { page: 2 },
      staleTime: 1000,
      headers: { "X-Test": "yes" },
    });

    expect(options.queryKey).toEqual(["todos", { page: 2 }]);
    expect(options.staleTime).toBe(1000);
    expect(options).not.toHaveProperty("headers");
    expect(options).not.toHaveProperty("url");
  });

  it("works with prefetchQuery, ensureQueryData and getQueryData", async () => {
    const { adapter, calls } = createMockAdapter(() => ({
      data: [{ id: 1, title: "a" }],
    }));
    const api = createApiClient({ adapter });
    const { queryClient, wrapper } = createWrapper();
    const todos = api.queryOptions<Todo[]>({ key: "todos", url: "/todos" });

    await queryClient.prefetchQuery(todos);
    expect(calls).toHaveLength(1);
    expect(queryClient.getQueryData<Todo[]>(todos.queryKey)).toEqual([
      { id: 1, title: "a" },
    ]);

    const data = await queryClient.ensureQueryData(todos);
    expectTypeOf(data).toEqualTypeOf<Todo[]>();
    expect(calls).toHaveLength(1);

    // A hook with the same args reads the prefetched entry.
    const { result } = renderHook(
      () =>
        api.useQuery<Todo[]>({ key: "todos", url: "/todos", staleTime: 60_000 }),
      { wrapper }
    );
    expect(result.current.data).toEqual([{ id: 1, title: "a" }]);
    expect(calls).toHaveLength(1);
  });

  it("works with TanStack's useQuery, useQueries and useSuspenseQuery", async () => {
    const { adapter } = createMockAdapter((config) => ({
      data: { id: Number(config.url?.split("/").pop()), title: "t" },
    }));
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();
    const todo = (id: number) =>
      api.queryOptions<Todo>({ key: ["todo", id], url: `/todos/${id}` });

    const { result } = renderHook(
      () => ({
        one: useQuery(todo(1)),
        many: useQueries({ queries: [todo(2), todo(3)] }),
      }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.one.data?.id).toBe(1));
    await waitFor(() =>
      expect(result.current.many.map((q) => q.data?.id)).toEqual([2, 3])
    );

    const Item = () => {
      const { data } = useSuspenseQuery(todo(4));
      expectTypeOf(data).toEqualTypeOf<Todo>();
      return <p>todo {data.id}</p>;
    };
    render(
      <Suspense fallback={<p>loading</p>}>
        <Item />
      </Suspense>,
      { wrapper }
    );
    expect(await screen.findByText("todo 4")).toBeTruthy();
  });

  it("hydrates a server-prefetched query (SSR)", async () => {
    const { adapter, calls } = createMockAdapter(() => ({ data: "server" }));
    const api = createApiClient({ adapter });
    const server = createWrapper().queryClient;
    await server.prefetchQuery(
      api.queryOptions<string>({ key: "greeting", url: "/greeting" })
    );

    const { queryClient } = createWrapper();
    const Greeting = () => {
      const { data } = api.useQuery<string>({
        key: "greeting",
        url: "/greeting",
        staleTime: 60_000,
      });
      return <p>{data}</p>;
    };
    render(
      <QueryClientProvider client={queryClient}>
        <HydrationBoundary state={dehydrate(server)}>
          <Greeting />
        </HydrationBoundary>
      </QueryClientProvider>
    );
    expect(await screen.findByText("server")).toBeTruthy();
    expect(calls).toHaveLength(1);
  });
});

describe("select", () => {
  it("can change the data's shape", async () => {
    const { adapter } = createMockAdapter(() => ({
      data: [
        { id: 1, title: "a" },
        { id: 2, title: "b" },
      ],
    }));
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        api.useQuery({
          key: "todos",
          url: "/todos",
          select: (todos: Todo[]) => todos.map((t) => t.title),
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.data).toEqual(["a", "b"]));
    expectTypeOf(result.current.data).toEqualTypeOf<string[] | undefined>();
  });

  it("accepts an explicit TSelected", async () => {
    const { adapter } = createMockAdapter(() => ({ data: [{ id: 1, title: "a" }] }));
    const api = createApiClient({ adapter });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        api.useQuery<Todo[], Error, number>({
          key: "todos",
          url: "/todos",
          select: (todos) => todos.length,
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.data).toBe(1));
    expectTypeOf(result.current.data).toEqualTypeOf<number | undefined>();
  });
});

describe("default error type", () => {
  it("follows React Query's default (Error unless registered)", () => {
    const api = createApiClient();
    const { result } = renderHook(
      () => ({
        query: api.useQuery({ key: "x", url: "/x", enabled: false }),
        mutation: api.useMutation({ url: "/x" }),
      }),
      { wrapper: createWrapper().wrapper }
    );
    expectTypeOf(result.current.query.error).toEqualTypeOf<Error | null>();
    expectTypeOf(result.current.mutation.error).toEqualTypeOf<Error | null>();
  });
});
