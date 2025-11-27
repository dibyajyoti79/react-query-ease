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
