## react-query-ease

Minimal Axios + React Query helper. Create per-service clients and use `client.useQuery` / `client.useMutation` without repeating Axios boilerplate.

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

Want the full CRUD + folder structure walkthrough? Check [examples/todo-crud.md](examples/todo-crud.md). Need interceptor reference? See [examples/interceptors.md](examples/interceptors.md).

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