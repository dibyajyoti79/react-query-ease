# Prefetching, SSR and Suspense

`api.queryOptions(args)` takes exactly the args of `api.useQuery` and returns the `{ queryKey, queryFn, ...options }` the hook builds, with `params` appended to the key. Anything in TanStack Query that takes query options accepts it.

## Define queries once

```ts
// lib/api/queries.ts — no "use client", so Server Components can import it
import { api } from "./config";
import type { Todo } from "./types";

export const todosQuery = (page = 1) =>
  api.queryOptions<Todo[]>({ key: ["todos"], url: "/todos", params: { page } });

export const todoQuery = (id: number) =>
  api.queryOptions<Todo>({ key: ["todo", id], url: `/todos/${id}` });
```

`todosQuery(2).queryKey` is `["todos", { page: 2 }]`, the same key `api.useQuery` uses for those args.

## Next.js App Router (server prefetch + hydration)

```tsx
// app/todos/page.tsx — Server Component
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { todosQuery } from "@/lib/api/queries";
import { TodoList } from "./TodoList";

export default async function TodosPage() {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery(todosQuery());
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TodoList />
    </HydrationBoundary>
  );
}
```

```tsx
// app/todos/TodoList.tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { todosQuery } from "@/lib/api/queries";

export function TodoList() {
  const { data = [] } = useQuery({ ...todosQuery(), staleTime: 60_000 });
  return <ul>{data.map((t) => <li key={t.id}>{t.title}</li>)}</ul>;
}
```

`api.useQuery({ key: ["todos"], url: "/todos", params: { page: 1 } })` reads the same hydrated entry.

Server caveats:

- `baseURL` must be absolute on the server
- An auth interceptor whose token getter reads `localStorage` or `document.cookie` can't run there. Forward the request's cookies/headers (`next/headers`) per request, or create a separate server client
- Create a new `QueryClient` per request on the server; never share one between users
- Give client queries a `staleTime` above 0 (per query or in `defaultOptions`), or hydrated data is refetched on mount

## Prefetch on hover / before navigation

```tsx
const queryClient = useQueryClient();
<Link href={`/todos/${id}`} onMouseEnter={() => queryClient.prefetchQuery(todoQuery(id))} />
```

Router loaders (TanStack Router, React Router):

```ts
loader: ({ params }) => queryClient.ensureQueryData(todoQuery(Number(params.id)))
```

## Suspense (v5)

```tsx
"use client";
import { useSuspenseQuery } from "@tanstack/react-query";

function TodoDetail({ id }: { id: number }) {
  const { data } = useSuspenseQuery(todoQuery(id)); // data: Todo, never undefined
  return <h1>{data.title}</h1>;
}

<Suspense fallback={<Spinner />}>
  <TodoDetail id={1} />
</Suspense>
```

## Parallel queries

```ts
const results = useQueries({ queries: ids.map((id) => todoQuery(id)) });
```

## Reading and writing the cache

```ts
queryClient.getQueryData<Todo>(todoQuery(id).queryKey);
queryClient.setQueryData<Todo>(todoQuery(id).queryKey, (old) => old && { ...old, completed: true });
```

Never rebuild a key by hand: it misses `params`, and `["todos"]` won't match `["todos", { page: 1 }]` exactly.

## Infinite lists

There is no `api.useInfiniteQuery`. Use TanStack's hook with the request helpers:

```ts
const query = useInfiniteQuery({
  queryKey: ["todos", "infinite"],
  queryFn: ({ pageParam, signal }) =>
    api.get<{ items: Todo[]; next?: number }>("/todos", { params: { page: pageParam }, signal }),
  initialPageParam: 1,
  getNextPageParam: (last) => last.next,
});
```

`keyToInvalidate: ["todos"]` still invalidates it, since invalidation matches by prefix.
