---
name: react-query-ease
description: Sets up react-query-ease — a typed Axios + React Query wrapper — with API clients, typed useQuery/useMutation hooks, auto-invalidation, auth token refresh, and streaming hooks. Use this skill whenever the user asks about data fetching, API client setup, React Query, Axios, token refresh, auth interceptors, streaming/SSE hooks, or typed HTTP hooks in React or Next.js — even if they don't mention "react-query-ease" by name. Also use it for prefetching, Next.js SSR with HydrationBoundary, useSuspenseQuery / useQueries with typed API calls, and typing React Query errors as AxiosError. Trigger on phrases like "set up API calls", "how do I fetch data in Next.js", "React Query setup", "Axios interceptor", "refresh token logic", "typed fetch hook", "useQuery hook", "useMutation hook", "streaming response React", "SSE hook", or "API client TypeScript".
license: MIT
---

# react-query-ease

Minimal typed wrapper combining Axios + React Query. Create per-service API clients and use `client.useQuery` / `client.useMutation` without repeating Axios boilerplate.

## Core Workflow

1. **Install** — add package + peer deps
2. **Create client** — `createApiClient` with `baseURL` in `src/config/apiClients.ts`
3. **Write typed hooks** — `useQuery` / `useMutation` wrappers in `src/hooks/`
4. **Add auth** — `createAuthInterceptor` in `configure` callback
5. **Prefetch / SSR / Suspense** — `api.queryOptions` with `prefetchQuery`, `HydrationBoundary`, `useSuspenseQuery`
6. **Add streaming** — `useStream` for chunked/SSE endpoints

## Installation

```bash
npm install react-query-ease axios @tanstack/react-query
```

Requires TanStack Query v5, axios 1.8.2+ and React 18+. Use v5 option names (`gcTime`, `throwOnError`, `isPending`, `placeholderData: keepPreviousData`); v4 names like `cacheTime` are not React Query options here and get sent to Axios.

Wrap app in `QueryClientProvider`:

```tsx
// src/components/providers/QueryProvider.tsx
"use client"; // required in Next.js App Router

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

**Next.js App Router** — add `QueryProvider` to your root layout:

```tsx
// app/layout.tsx
import { QueryProvider } from "@/components/providers/QueryProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
```

> Files that call hooks must include `"use client"` at the top; Server Components cannot use React Query hooks. Keep the client (`lib/api/config.ts`) and `api.queryOptions` builders **without** `"use client"`, so Server Components can import them to prefetch (see "Prefetching, SSR and Suspense").

## Client Setup

Create one client per API service. Keep clients in `lib/api/config.ts`:

```ts
// lib/api/config.ts
import { createApiClient } from "react-query-ease";

export const api = createApiClient({
  baseURL: "https://api.example.com",
});
```

`createApiClient` accepts all standard Axios config (`headers`, `timeout`, `withCredentials`, etc.) plus:

- `configure` — callback for interceptors
- `paramsInKey` (default `true`) — add `params` to query keys. `false` restores the 0.3.x keys
- `cancelable` (default `true`) — pass React Query's `AbortSignal` to Axios, so unmounting and `cancelQueries()` abort requests. `false` restores 0.3.x behaviour

## Request helpers

Outside hooks, each client has `get`, `post`, `put`, `patch`, `delete` and `request`. All of them resolve to `response.data`.

```ts
await api.get("/todos", { params: { page: 2 } });
await api.post("/todos", { title: "Buy milk" }, { timeout: 5000 }); // (url, data, config), like Axios
await api.post("/todos", { data: { title: "Buy milk" } });          // (url, config) also works
```

With **two** arguments, the second is the **config**. `api.post("/todos", { title })` sends no body (TypeScript flags it, and a dev-mode warning is logged). Prefer the 3-argument form for `post`, `put` and `patch`.

## useQuery

```ts
// lib/api/hooks/useTodo.ts
import { api } from "../config";

export interface ApiError {
  message: string;
  status: number;
}

export interface Todo {
  id: number;
  title: string;
  completed: boolean;
}

export const useTodos = () => {
  const query = api.useQuery<Todo[]>({
    url: "/todos",
    key: ["todos"],
    // Optional:
    method: "GET", // defaults to GET
    params: { page: 1 }, // query string params; also added to the cache key
    staleTime: 5 * 60_000, // React Query options pass through
    enabled: true,
  });
  return {
    todos: query.data ?? [],
    isLoadingTodos: query.isLoading,
    ...query,
  };
};

const { todos, isLoadingTodos } = useTodos();
```

**Key rules:**

- `key` — React Query cache key; use arrays for namespacing
- `params` — appended to the key, so the example above is cached as `["todos", { page: 1 }]`. Don't repeat params in `key`. Use the full key with `getQueryData`/`setQueryData`. Prefix matching (`invalidateQueries({ queryKey: ["todos"] })`, `keyToInvalidate`) still covers it. Per-query opt-out: `paramsInKey: false`
- `url` — resolved against client `baseURL`
- Axios options (`headers`, `params`, `timeout`) go to the request, and React Query options (`staleTime`, `enabled`, `retry`, `select`, etc.) go to `useQuery`; each only reaches its own side
- `axios: { ... }` — optional Axios config merged last, for explicit overrides
- Unmounting or `cancelQueries()` aborts the request (client option `cancelable: false` turns this off)
- `select` can change the shape: `api.useQuery<Todo[], ApiError, number>({ ..., select: (t) => t.length })`
- `TError` defaults to React Query's default error, so a `declare module "@tanstack/react-query" { interface Register { defaultError: AxiosError } }` applies to every hook
- `api.queryOptions(args)` — same args as `api.useQuery`, returns the exact `{ queryKey, queryFn, ...options }`. Use it for `queryClient.prefetchQuery` / `ensureQueryData` (Next.js SSR with `HydrationBoundary`), `useSuspenseQuery`, `useQueries`, and `queryOptions(args).queryKey` with `getQueryData` / `setQueryData`. Never rebuild the key by hand

## useMutation

```ts
// lib/api/hooks/useTodo.ts
export interface NewTodo {
  title: string;
}

export interface UpdateInput {
  id: number;
  title?: string;
  completed?: boolean;
}

export const useCreateTodo = () => {
  const mutation = api.useMutation<Todo, ApiError, NewTodo>({
    url: "/todos",
    method: "POST",
    keyToInvalidate: ["todos"], // auto-invalidates after success
  });
  return {
    createTodo: mutation.mutate,
    isCreatingTodo: mutation.isPending,
    ...mutation,
  };
};

const { createTodo, isCreatingTodo } = useCreateTodo();
createTodo({ title: "Buy milk" });
```

**Dynamic URL** — pass a function when the URL depends on variables:

```ts
// lib/api/hooks/useTodo.ts
export const useUpdateTodo = () => {
  const mutation = api.useMutation<Todo, ApiError, UpdateInput>({
    url: (variables) => `/todos/${variables.id}`,
    method: "PATCH",
    keyToInvalidate: ["todos"],
  });
  return {
    updateTodo: mutation.mutate,
    isUpdatingTodo: mutation.isPending,
    ...mutation,
  };
};
```

**Key rules:**

- If `data` is not set, mutation variables become the request body automatically (except for `GET`/`HEAD`). `DELETE` sends them too; add `body: () => undefined` when the id is only in the URL
- `body: (variables) => ...` — build the request body yourself, e.g. `body: ({ id, ...rest }) => rest`
- `keyToInvalidate` accepts a single key, a string, or an array of keys/strings — e.g. `keyToInvalidate: [["todos"], ["stats"]]` to bust multiple caches at once
- `keyToInvalidate` can also be a function of the response and variables — e.g. `keyToInvalidate: (todo, vars) => [["todos", vars.id], ["lists", todo.listId]]`
- All React Query mutation options (`onSuccess`, `onError`, `onSettled`, `retry`) pass through

**Using `mutateAsync`** — for async/await with try/catch:

```ts
const { mutateAsync: createTodo, isPending } = useCreateTodo();

const handleSubmit = async () => {
  try {
    const newTodo = await createTodo({ title: "Buy milk" });
    console.log("Created:", newTodo);
  } catch (err) {
    console.error("Failed:", err);
  }
};
```

## Auth Interceptor

Wire up token auth in `configure`:

```ts
// lib/api/config.ts
import { createApiClient, createAuthInterceptor } from "react-query-ease";

const authInterceptor = createAuthInterceptor({
  getAccessToken: () => localStorage.getItem("accessToken"),
  getRefreshToken: () => localStorage.getItem("refreshToken"),
  refreshTokens: async ({ refreshToken }) => {
    const res = await fetch("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    }).then((r) => r.json());
    localStorage.setItem("accessToken", res.accessToken);
    localStorage.setItem("refreshToken", res.refreshToken);
    return res; // must return { accessToken, refreshToken? }
  },
  onRefreshFailure: () => {
    window.location.assign("/login?session_expired=true");
  },
});

export const api = createApiClient({
  baseURL: "https://api.example.com",
  configure: authInterceptor,
});
```

`createAuthInterceptor` coalesces concurrent 401s into one refresh, retries queued requests with the fresh token, and covers both Axios requests and `useStream` calls.

- **Refresh through the same client** with `skipAuth: true` on that request: `api.post("/auth/refresh", { refresh_token }, { skipAuth: true })`. Without it, the refresh call's own 401 waits on itself
- `skipAuth: true` works on any request or stream that should go out without the token
- A refresh that never settles is rejected after `refreshTimeoutMs` (default `30000`)
- Apply the interceptor once per client; a second registration is ignored

See `references/auth-interceptor.md` for all options and chaining multiple interceptors.

## useStream

For LLM/SSE/chunked endpoints:

```tsx
// lib/api/hooks/useChat.ts
export const useChat = () => {
  const stream = api.useStream<{ prompt: string }>({
    url: "/chat",
    method: "POST",
    onComplete: () => console.log("Done"),
    onError: (err) => console.error(err),
  });
  return {
    chatData: stream.data,
    isChatLoading: stream.isLoading,
    isChatStreaming: stream.isStreaming,
    ...stream,
  };
};

const { chatData, isChatLoading, start, abort } = useChat();
await start({ prompt: "Hello" });
abort();
```

Return values:

- `data` — accumulated text from all chunks
- `isStreaming` — `true` from `start()` until the stream completes, fails or is aborted
- `isLoading` — currently always equal to `isStreaming`. For a "connecting" indicator use `isStreaming && !data`
- `error` — connection error (abort does NOT set error)
- `start(variables?)` — launches stream; `variables` become request body. It's the same function on every render, so an inline config is fine. Calling it again aborts the running stream, and that stream's late chunks are ignored
- `abort()` — cancels the stream, also while still connecting (then `start()` rejects with `AbortError`)
- Streams go through the client's Axios instance (fetch adapter, `responseType: "stream"`), so `baseURL`, default headers, `withCredentials`, XSRF and every `configure` interceptor apply. A failed stream rejects with an `AxiosError`

See `references/streaming.md` for full API table and async iterator usage.

## Recommended Project Structure

```
lib/
  api/
    config.ts              ← createApiClient instance (+ auth interceptor)
    hooks/
      useTodo.ts           ← typed hook wrappers (useQuery / useMutation)
src/
  components/
    Todos.tsx              ← UI; imports hooks, not clients directly
```

See `references/examples.md` for a complete CRUD walkthrough.

## QueryClient Config + DevTools

```tsx
// src/components/providers/QueryProvider.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 10 * 60_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

Install: `npm install @tanstack/react-query-devtools`

See `references/query-client-config.md` for full defaults table and global error handler setup.

## Error Handling

Register the error type once and every `api.useQuery` / `api.useMutation` uses it, no second generic needed. Axios rejects with an `AxiosError`, so register that (with your server's error body), not a plain interface:

```ts
// lib/api/react-query.d.ts
import type { AxiosError } from "axios";

declare module "@tanstack/react-query" {
  interface Register {
    defaultError: AxiosError<{ message: string }>;
  }
}
```

Or pass `TError` per hook:

```ts
export const useTodos = () => {
  const query = api.useQuery<Todo[], ApiError>({
    url: "/todos",
    key: ["todos"],
  });
  return {
    todos: query.data ?? [],
    todosError: query.error, // typed as ApiError | null
    isTodosError: query.isError,
    isLoadingTodos: query.isLoading,
    ...query,
  };
};
```

See `references/error-handling.md` for `mutateAsync` try/catch and `QueryErrorResetBoundary`.

## Prefetching, SSR and Suspense

`api.queryOptions(args)` takes the same args as `api.useQuery` and returns the exact `{ queryKey, queryFn, ...options }`, with `params` in the key. Define each query once and reuse it everywhere:

```ts
// lib/api/queries.ts (no "use client")
import { api } from "./config";

export const todosQuery = (page = 1) =>
  api.queryOptions<Todo[]>({ key: ["todos"], url: "/todos", params: { page } });
export const todoQuery = (id: number) =>
  api.queryOptions<Todo>({ key: ["todo", id], url: `/todos/${id}` });
```

```tsx
// app/todos/page.tsx (Server Component)
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { todosQuery } from "@/lib/api/queries";

export default async function TodosPage() {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery(todosQuery());
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Todos />
    </HydrationBoundary>
  );
}
```

```tsx
// "use client" component
const { data } = useQuery({ ...todosQuery(), staleTime: 60_000 }); // or api.useQuery with the same args
const { data: todo } = useSuspenseQuery(todoQuery(id));            // inside <Suspense>
const results = useQueries({ queries: ids.map(todoQuery) });
queryClient.setQueryData(todoQuery(id).queryKey, updated);
await queryClient.ensureQueryData(todoQuery(id));                  // e.g. in a router loader
```

**Rules:**

- Never rebuild a key by hand for `getQueryData` / `setQueryData`; use `xQuery(...).queryKey`, which includes `params`
- On the server, `baseURL` must be absolute, and token getters that read `localStorage` don't work. Forward cookies/headers or use a separate server client
- Set `staleTime` > 0 on the client, so hydrated data isn't refetched immediately
- There is no `api.useInfiniteQuery`; use TanStack's `useInfiniteQuery` with `api.get` in `queryFn`

See `references/prefetch-ssr.md` for prefetch-on-hover, Suspense and infinite lists.

## Optimistic Updates

This snippet assumes the list query is `{ key: ["todos"] }` without `params`. If it has params, its key is `["todos", params]`. Get the exact key from `api.queryOptions(...).queryKey` (see "Prefetching, SSR and Suspense"), or use `queryClient.setQueriesData({ queryKey: ["todos"] }, updater)` to update every matching list.

```ts
onMutate: async (variables) => {
  await queryClient.cancelQueries({ queryKey: ["todos"] });
  const previousTodos = queryClient.getQueryData<Todo[]>(["todos"]);
  queryClient.setQueryData<Todo[]>(["todos"], (old = []) =>
    old.map((t) => t.id === variables.id ? { ...t, ...variables } : t)
  );
  return { previousTodos };
},
onError: (_err, _vars, context) => {
  queryClient.setQueryData(["todos"], context?.previousTodos);
},
onSettled: () => {
  queryClient.invalidateQueries({ queryKey: ["todos"] });
},
```

See `references/optimistic-updates.md` for full create/toggle/delete patterns.
