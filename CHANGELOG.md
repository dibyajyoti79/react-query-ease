# Changelog

## Unreleased

### Features

- **`api.queryOptions(args)`** takes the same arguments as `api.useQuery` and returns the exact `{ queryKey, queryFn, ...options }` the hook uses, `params` included in the key. Use it with `queryClient.prefetchQuery` / `fetchQuery` / `ensureQueryData` (Next.js SSR with `HydrationBoundary`), `useSuspenseQuery`, `useQueries`, `useQuery`, and `getQueryData` / `setQueryData`.
- **`keyToInvalidate` can be a function**: `(data, variables) => keys`, for keys like `["todos", id]` built from the response or the variables. Return `undefined` to invalidate nothing.
- **`select` can change the data's shape.** `useQuery` takes a third generic, `TSelected`: `api.useQuery<Todo[], AxiosError, number>({ ..., select: (todos) => todos.length })`. It is also inferred from `select` when you don't pass generics.
- New exported types: `ApiQueryArgs`, `ApiQueryOptions`, `ApiMutationArgs`, `InvalidateKeys`, `DefaultError`.

### Changes

- **`TError` now defaults to React Query's default error type** instead of `unknown`. In v5 that is `Register["defaultError"]`, so `declare module "@tanstack/react-query" { interface Register { defaultError: AxiosError } }` now applies to `api.useQuery` and `api.useMutation`. Without a registration it is `Error` in v5 and stays `unknown` in v4. This only changes types; if code relied on `error` being `unknown`, pass `unknown` as the second generic.

- **axios is now a peer dependency** instead of a regular dependency, with a minimum of `1.8.2` (which fixes CVE-2025-27152). The package now uses your app's own axios, so you no longer risk two copies in the bundle or clashing `AxiosInstance` types, and you control axios security updates.
- **Streams are sent through the Axios instance.** `api.stream()` and `useStream` now use Axios' `fetch` adapter (`responseType: "stream"`) instead of calling `fetch` directly. They now get everything your other requests get: `baseURL`, default headers, `withCredentials`, the XSRF cookie header for cookie-based auth, and every interceptor added in `configure`. Token refresh on 401 now goes through the auth interceptor itself instead of a separate copy of that logic.

### Migration

| If you… | Do this |
|---|---|
| install with pnpm or yarn and don't already have axios in your app | `pnpm add axios` / `yarn add axios`. npm 7+ installs peer dependencies for you. |
| use an axios version older than `1.8.2` | Upgrade axios: `npm i axios@latest`. |
| read `error.response` from a failed stream as a fetch `Response` (for example `error.response.json()`) | A failed stream now rejects with an `AxiosError`. `error.response.status` works as before; the body is on `error.response.data`. |
| have interceptors in `configure` that shouldn't run on streams | Check for `config.responseType === "stream"` in the interceptor. |
| test streams in Node or jsdom with a relative URL and no `baseURL` | Give the client an absolute `baseURL` in tests. Node's `Request` can't resolve `/chat` on its own; browsers can. |

## 0.5.0

Bug fixes that keep existing code working. Two of them change behaviour, and each has a one-line opt-out.

### Behaviour changes

- **`params` are now part of the query key.** `useQuery({ key: ["todos"], params: { page: 2 } })` used to share a cache entry with page 1. The key is now `["todos", { page: 2 }]`. Queries without `params` keep exactly the same key, and `invalidateQueries({ queryKey: ["todos"] })` and `keyToInvalidate: ["todos"]` still match.
- **Queries can be cancelled.** React Query's `AbortSignal` is now passed to Axios, so `queryClient.cancelQueries()` works and a request is aborted when its last component unmounts. A `signal` you pass yourself is still used.

### Migration

You only need to act if one of these applies:

| If you… | Do this |
|---|---|
| call `setQueryData` / `getQueryData` / `prefetchQuery` with the bare key for a query that has `params`, or invalidate it with `exact: true` | Add the params to the key: `["todos", { page: 2 }]`. Or opt out with `createApiClient({ paramsInKey: false })`, or `paramsInKey: false` on that one query. |
| rely on a request finishing and being cached after the component unmounts | `createApiClient({ cancelable: false })` |

### Fixes

- React Query options (`enabled`, `staleTime`, `select`, `retry`, `onError`, …) are no longer sent to Axios, and Axios options (`headers`, `timeout`, …) are no longer sent to React Query.
- The auth interceptor no longer hangs forever when the refresh request itself gets a 401. Mark the refresh call with `{ skipAuth: true }`, and a pending refresh now times out after `refreshTimeoutMs` (default 30 s).
- Mutations no longer send variables as the body of a `GET` or `HEAD` request. `DELETE` still sends them, as before.
- Applying `createAuthInterceptor` twice to the same instance now logs a warning in development and is ignored, instead of refreshing twice.
- `useStream`:
  - `start` is now stable across renders, even when the config is an inline object. It reads the latest config when it runs.
  - Calling `start()` again no longer lets the replaced stream mark the new one as finished, and the replaced stream's callbacks no longer fire.
  - `abort()` and unmounting now also cancel a stream that is still connecting. Before, the request carried on and the stream started anyway. In that case `start()` rejects with an `AbortError`.
- Node ESM: the ESM build is now `dist/index.mjs` instead of `dist/index.esm.js`, so importing the package from Node's ESM loader (SSR, test runners) works instead of failing with "Unexpected module syntax". Bundlers are unaffected. Deep imports of `dist/` files were never allowed by the `exports` map.
- Auth state is stored in a private registry instead of `any` fields on the Axios instance. The old `__authOptions` / `__queueRefresh` fields are still set but are deprecated and will be removed in 1.0.

### New options

- `api.post` / `api.put` / `api.patch` also accept the Axios form `(url, data, config)`. The 2-argument `(url, config)` form works exactly as before. In development, a 2-argument call whose second argument looks like a request body logs a warning, because that body is not sent.
- `ApiClientOptions`, `SimpleApiClient`, `RequestMethod` and `BodyRequestMethod` are now exported types.
- `createApiClient({ paramsInKey, cancelable })`
- `useQuery({ paramsInKey, axios })`
- `useMutation({ body, axios })`
- Per-request `skipAuth: true` (Axios requests and `stream()`)
- `createAuthInterceptor({ refreshTimeoutMs })`

### Compatibility

- The peer range is now `@tanstack/react-query@^4.0.0 || ^5.0.0`. The old range, `>=4.0.0`, would also have allowed a future v6. CI tests both v4 (React 18) and v5 (React 19).
- The `axios` dependency range is widened from `^1.13.2` to `^1.3.0`, the oldest version that passes the tests and typechecks. If your app already has a compatible Axios, npm and pnpm can now reuse it instead of installing a second copy. That avoids `instanceof AxiosError` and type mismatches between the two copies. Axios stays a regular dependency, so nothing changes for installs. Moving it to a peer dependency is planned for 1.0.
- Tests: added a Vitest suite with 45 tests.
- Docs: the guides and the Claude Code skill now cover the new options and the `(url, data, config)` form. They also correct the `useStream` docs: `isLoading` is always equal to `isStreaming` and does not mean "connecting". Use `isStreaming && !data` for a connecting indicator.
- Linting: replaced the unconfigured ESLint setup with [oxlint](https://oxc.rs) (`npm run lint`, also run in CI). Fixing its findings also removed a useless `try/catch` and some `any` casts in `createStream`, and stopped `useStream` from writing a ref during render.
