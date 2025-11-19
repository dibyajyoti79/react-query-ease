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
    endpoint: "/todos",
    method: "GET",
    key: ["todos"],
  });

  return {
    todos: query.data ?? [],
    isLoadingTodos: query.isLoading,
    ...query,
  };
};

const useCreateTodo = () => {
  const mutation = api.useMutation({
    endpoint: "/todos",
    method: "POST",
    invalidateKeys: ["todos"],
  });

  return {
    createTodo: mutation.mutate,
    isCreatingTodo: mutation.isPending,
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

Want the full CRUD + folder structure walkthrough? Check [examples/todo-crud.md](examples/todo-crud.md).
