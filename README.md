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

### Claude Code Skill

Get AI-assisted setup, typed hooks, auth interceptors, and streaming — directly in your editor:

```bash
claude skills install github:dibyajyoti79/react-query-ease
```

Then trigger with `/react-query-ease` in any Claude Code session.

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
      api.post<{ accessToken: string }>("/auth/refresh", {
        data: { refresh_token: tokens.refresh },
        skipAuth: true,
      }),
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
