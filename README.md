## react-query-ease

Minimal Axios + React Query helper. Create an Axios client per service and call `client.useQuery` / `client.useMutation` with just method + endpoint (+ optional overrides).

### Install

```bash
npm install react-query-ease
npm install react @tanstack/react-query
```

### Usage

```ts
import { createApiClient } from "react-query-ease";

const api = createApiClient({
  baseURL: "https://api.example.com",
});

const todosQuery = api.useQuery({
  endpoint: "/todos",
  method: "GET",
  key: ["todos"],
});

const createTodoMutation = api.useMutation({
  endpoint: "/todos",
  method: "POST",
  invalidateKeys: ["todos"],
});

`key` is required for queries so you control the React Query cache.
`invalidateKeys` automatically calls `queryClient.invalidateQueries` for those keys after a successful mutation. Pass a single key, string, or array of keys.
```

For a full Todo CRUD walkthrough (folder structure, hooks, and components), see `examples/todo-crud.md`. Repository: https://github.com/dibyajyoti79/react-query-ease
