# react-query-ease

[![npm version](https://img.shields.io/npm/v/react-query-ease.svg)](https://www.npmjs.com/package/react-query-ease)
[![npm downloads](https://img.shields.io/npm/dm/react-query-ease.svg)](https://www.npmjs.com/package/react-query-ease)
[![bundle size](https://img.shields.io/bundlephobia/minzip/react-query-ease)](https://bundlephobia.com/package/react-query-ease)
[![types](https://img.shields.io/npm/types/react-query-ease.svg)](https://www.npmjs.com/package/react-query-ease)
[![license](https://img.shields.io/npm/l/react-query-ease.svg)](./LICENSE)

**Typed Axios + TanStack React Query API clients in a few lines.** Create one client per service, then call `api.useQuery` / `api.useMutation` with no repeated Axios boilerplate, query functions, or manual cache invalidation.

### Features

- 🧩 **One client per service.** `createApiClient({ baseURL })` gives you `useQuery`, `useMutation`, and plain `get/post/put/patch/delete` helpers.
- 🔁 **Auto cache invalidation.** `keyToInvalidate: ["todos"]` refetches queries after a successful mutation.
- 🔐 **Single-flight token refresh.** `createAuthInterceptor` attaches tokens and refreshes once when several requests get a 401 at the same time, then retries the queued requests.
- 🌊 **Streaming hooks.** `useStream` streams chunked and SSE responses, such as LLM or AI chat output, and shares the same auth refresh.
- 🦺 **TypeScript-first.** Generic `TData` / `TError` / `TVariables`, with every Axios and React Query option passed through.
- ⚛️ **Works with React and Next.js.** Ships ESM and CJS, tree-shakeable with `sideEffects: false`.

### Why not just TanStack Query + Axios?

TanStack Query handles caching, not HTTP: you still write a query function for every endpoint, an Axios instance, invalidation logic and token refresh, in every app. react-query-ease is that layer, written once, tested, and built **on top of** TanStack Query, so you keep everything it gives you.

**With TanStack Query + Axios:**

```tsx
const http = axios.create({ baseURL: "/api" });

const useTodos = (page: number) =>
  useQuery({
    queryKey: ["todos", { page }],
    queryFn: ({ signal }) =>
      http.get<Todo[]>("/todos", { params: { page }, signal }).then((r) => r.data),
  });

const useCreateTodo = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (todo: NewTodo) => http.post<Todo>("/todos", todo).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });
};
```

**With react-query-ease:**

```tsx
const api = createApiClient({ baseURL: "/api" });

const useTodos = (page: number) =>
  api.useQuery<Todo[]>({ url: "/todos", key: ["todos"], params: { page } });

const useCreateTodo = () =>
  api.useMutation<Todo, unknown, NewTodo>({ url: "/todos", method: "POST", keyToInvalidate: ["todos"] });
```

What you stop writing by hand:

| | TanStack Query + Axios | react-query-ease |
|---|---|---|
| Query function per endpoint | You write it | Built from `url`, `method` and `params` |
| `params` in the query key | Easy to forget, which serves stale pages | Added for you |
| Cancellation on unmount | Pass `signal` yourself, every time | On by default |
| Invalidate after a mutation | `useQueryClient` + `onSuccess` | `keyToInvalidate: ["todos"]` |
| Unwrapping `response.data` | Every call | Done for you |
| Token refresh on 401 | Write your own interceptor, queue and retry | `createAuthInterceptor`: one refresh for many concurrent 401s, then retries |
| Streaming (SSE, LLM output) | Not covered; hand-roll `fetch` + a reader | `useStream`, sharing the same auth and refresh |

Nothing is hidden: every TanStack Query option (`staleTime`, `enabled`, `select`, …) and every Axios option (`headers`, `timeout`, …) still works on the same hook, and `useQueryClient`, devtools and `invalidateQueries` work as usual.

### When to use it

TanStack Query gives you caching, background refetching, retries and request deduplication. react-query-ease adds the HTTP layer on top: the Axios client, query functions, cache keys, invalidation and token refresh. Use the two together when:

- **Your app talks to one or more REST/JSON APIs** and has more than a handful of endpoints, so writing a query function and key for each one is real repetition.
- **You want Axios features**, such as interceptors, `baseURL`, default headers, timeouts and typed errors with `AxiosError`.
- **Your API uses access and refresh tokens.** `createAuthInterceptor` handles the 401 → refresh → retry flow, including many requests failing at once.
- **Mutations should refresh lists**, for example creating a todo refetches `["todos"]`, without wiring `useQueryClient` into every hook.
- **You stream responses**, such as LLM or AI chat output over SSE, and want streaming to share the same client, auth and refresh as your other requests.
- **You're on React or Next.js client components** and want typed hooks per service, with one client per backend, for example `authApi`, `billingApi`.

**When you don't need it:**

- Your backend has an OpenAPI spec: a code generator such as Orval can generate typed hooks for you.
- You only call one or two endpoints: plain TanStack Query is fine.
- You use GraphQL: use a GraphQL client such as Apollo or urql, or TanStack Query with a GraphQL fetcher.
- You fetch only on the server, in React Server Components or route handlers: React Query's hooks run only in client components.

### Claude Code skill

The repo includes an AI agent skill that sets up react-query-ease for you: API clients, typed hooks, auth interceptors and streaming.

**Claude Code plugin** (Claude Code 2.1.275 or later):

```
/plugin install react-query-ease --marketplace dibyajyoti79/react-query-ease
```

On older versions, add the marketplace first, then install:

```
/plugin marketplace add dibyajyoti79/react-query-ease
/plugin install react-query-ease@react-query-ease
```

**Any agent** (Claude Code, Cursor, Copilot, Codex and others), with the [`skills`](https://skills.sh) CLI (Node.js 22.20 or later):

```bash
npx skills add dibyajyoti79/react-query-ease
```

Add `-g` to install it for all your projects. Update it later with `npx skills update`.

The skill runs on its own when you ask your agent about data fetching, React Query or Axios setup. In Claude Code you can also run it directly with `/react-query-ease`.

### Install

```bash
npm install react-query-ease
npm install react @tanstack/react-query
```

### Quick example

```tsx
import { createApiClient } from "react-query-ease";

const api = createApiClient({
  baseURL: "https://api.example.com",
});

const useTodos = () => {
  const query = api.useQuery({
    url: "/todos",
    method: "GET",
    key: ["todos"],
    // All Axios config props (headers, timeout, etc.) and React Query options (staleTime, enabled, etc.) can be passed directly
  });

  return {
    todos: query.data ?? [],
    isLoadingTodos: query.isLoading,
    ...query,
  };
};

const useCreateTodo = () => {
  const mutation = api.useMutation({
    url: "/todos",
    method: "POST",
    keyToInvalidate: ["todos"],
    // All Axios config props and React Query options can be passed directly
  });

  return {
    createTodo: mutation.mutate,
    isCreatingTodo: mutation.isPending,
    ...mutation,
  };
};

// For dynamic URLs in mutations (e.g., `/todos/${id}`), use a function:
const useUpdateTodo = () => {
  const mutation = api.useMutation({
    url: (variables) => `/todos/${variables.id}`, // Dynamic URL from variables
    method: "PATCH",
    keyToInvalidate: ["todos"],
  });

  return {
    updateTodo: mutation.mutate,
    isUpdatingTodo: mutation.isPending,
    ...mutation,
  };
};

function TodoList() {
  const { todos, isLoadingTodos } = useTodos();
  const { createTodo, isCreatingTodo } = useCreateTodo();

  if (isLoadingTodos) return <p>Loading...</p>;

  return (
    <>
      <button
        disabled={isCreatingTodo}
        onClick={() => createTodo({ title: "Buy milk" })}
      >
        Add todo
      </button>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
    </>
  );
}
```

Want the full CRUD + folder structure walkthrough? Check [examples/todo-crud.md](examples/todo-crud.md). Need interceptor reference? See [examples/interceptors.md](examples/interceptors.md). For native streaming, check the [Streaming Guide](examples/streaming.md).

### Request helpers

Outside of hooks, every client also has plain request helpers. Each one resolves to the response body (`response.data`).

| Helper | Forms |
|---|---|
| `api.get(url, config?)` | Same as Axios |
| `api.delete(url, config?)` | Same as Axios. A body goes in `config.data` |
| `api.post` / `api.put` / `api.patch` | `(url, data, config)`, the Axios form, **or** `(url, config)` with the body in `config.data` |
| `api.request(config)` | Any request |

```ts
await api.post("/todos", { title: "Buy milk" }, { timeout: 5000 }); // Axios form
await api.post("/todos", { data: { title: "Buy milk" } });          // config form
```

> **Watch out:** with only two arguments, the second one is the **config**, not the body. `api.post("/todos", { title })` sends no body. TypeScript flags this, and in development the client logs a warning. Use the 3-argument form, or put the body in `data`.

### Built-in auth interceptor helper

```ts
import { createApiClient, createAuthInterceptor } from "react-query-ease";

const tokens = {
  access: null as string | null,
  refresh: null as string | null,
};

const authInterceptor = createAuthInterceptor({
  getAccessToken: () => tokens.access,
  getRefreshToken: () => tokens.refresh,
  refreshTokens: async () => {
    const result = await fetch("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: tokens.refresh }),
    }).then((res) => res.json());

    tokens.access = result.accessToken;
    tokens.refresh = result.refreshToken;

    return result;
  },
});

export const secureApi = createApiClient({
  baseURL: "/api",
  configure: authInterceptor,
});
```

`createAuthInterceptor` wires up access-token headers, coalesces simultaneous refreshes, retries queued requests with the fresh token, and allows you to plug in logout/error handling via the options object.
If your refresh call goes through the same client, mark it with `skipAuth: true`. Otherwise its own 401 would wait on the refresh that is already running:

```ts
let api: ReturnType<typeof createApiClient>;

api = createApiClient({
  baseURL: "/api",
  configure: createAuthInterceptor({
    getAccessToken: () => tokens.access,
    refreshTokens: () =>
      api.post<{ accessToken: string }>(
        "/auth/refresh",
        { refresh_token: tokens.refresh },
        { skipAuth: true }
      ),
    setTokens: (t) => {
      tokens.access = t.accessToken;
    },
  }),
});
```

A pending refresh is rejected after `refreshTimeoutMs` (default `30000`; `0` disables it), so requests fail instead of hanging.

### Options

| Option | Where | Default | What it does |
|---|---|---|---|
| `paramsInKey` | `createApiClient`, `useQuery` | `true` | Appends `params` to the query key, so each set of params is cached separately. Queries without `params` are unaffected. |
| `cancelable` | `createApiClient` | `true` | Passes React Query's `AbortSignal` to Axios, so `cancelQueries()` and unmounting abort in-flight requests. |
| `axios` | `useQuery`, `useMutation` | — | Axios config merged last. Use it for any Axios option you want to set explicitly. |
| `body` | `useMutation` | — | `(variables) => body`. Builds the request body. Without it, variables are sent as the body (except for `GET`/`HEAD`) unless `data` is set. |
| `skipAuth` | any request, `stream()` | `false` | Skips the auth interceptor: no token is attached and a 401 doesn't trigger a refresh. |
| `refreshTimeoutMs` | `createAuthInterceptor` | `30000` | Rejects a refresh that takes longer than this. |

Upgrading from 0.3.x? See the [changelog](CHANGELOG.md) for the two behaviour changes and their opt-outs.
