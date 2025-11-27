## Todo CRUD example

One way to organize a project that uses `react-query-ease`.

```
src/
  config/
    apiClients.ts
  hooks/
    todos.ts
  components/
    Todos.tsx
```

### 1. Configure the client (`config/apiClients.ts`)

```ts
import { createApiClient } from "react-query-ease";

export const todosApi = createApiClient({
  baseURL: "https://api.example.com",
});
```

### 2. Build typed hooks (`hooks/todos.ts`)

```ts
import { todosApi } from "../config/apiClients";

export type Todo = {
  id: string;
  title: string;
  completed: boolean;
};

export type NewTodo = Pick<Todo, "title">;
export type UpdateTodoInput = Partial<Omit<Todo, "id">> & { id: string };
export type TodoSearchFilters = { query: string };

export const useTodos = () => {
  const query = todosApi.useQuery<Todo[]>({
    url: "/todos",
    method: "GET",
    key: ["todos"],
  });

  return {
    todos: query.data ?? [],
    isTodoLoading: query.isLoading,
    ...query,
  };
};

export const useSearchTodos = (filters: TodoSearchFilters) => {
  const query = todosApi.useQuery<Todo[]>({
    url: "/todos/search",
    method: "GET",
    key: ["todos", "search", filters.query],
    params: { q: filters.query },
  });

  return {
    searchResults: query.data ?? [],
    isSearchLoading: query.isLoading,
    ...query,
  };
};

export const useCreateTodo = () => {
  const { mutate, isPending, ...rest } = todosApi.useMutation<
    Todo,
    unknown,
    NewTodo
  >({
    url: "/todos",
    method: "POST",
    keyToInvalidate: ["todos"],
  });

  return {
    createTodo: mutate,
    isCreatingTodo: isPending,
    ...rest,
  };
};

export const useUpdateTodo = () => {
  const { mutate, isPending, ...rest } = todosApi.useMutation<
    Todo,
    unknown,
    UpdateTodoInput
  >({
    url: (variables) => `/todos/${variables.id}`,
    method: "PATCH",
    keyToInvalidate: ["todos"],
  });

  return {
    updateTodo: mutate,
    isUpdatingTodo: isPending,
    ...rest,
  };
};

export const useDeleteTodo = () => {
  const { mutate, isPending, ...rest } = todosApi.useMutation<
    void,
    unknown,
    { id: string }
  >({
    url: (variables) => `/todos/${variables.id}`,
    method: "DELETE",
    keyToInvalidate: ["todos"],
  });

  return {
    deleteTodo: mutate,
    isDeletingTodo: isPending,
    ...rest,
  };
};
```

### 3. Wire everything in the UI (`components/Todos.tsx`)

```tsx
import {
  useTodos,
  useCreateTodo,
  useUpdateTodo,
  useDeleteTodo,
  useSearchTodos,
} from "../hooks/todos";

import { useState } from "react";

export function Todos() {
  const [search, setSearch] = useState("");
  const { todos, isTodoLoading } = useTodos();
  const { createTodo, isCreatingTodo } = useCreateTodo();
  const { updateTodo, isUpdatingTodo } = useUpdateTodo();
  const { deleteTodo, isDeletingTodo } = useDeleteTodo();
  const { searchResults, isSearchLoading } = useSearchTodos({ query: search });

  if (isTodoLoading) return <p>Loading...</p>;

  return (
    <>
      <button
        disabled={isCreatingTodo}
        onClick={() => createTodo({ title: "New todo" })}
      >
        Add Todo
      </button>

      <input
        value={search}
        placeholder="Search todos"
        onChange={(event) => setSearch(event.target.value)}
      />
      {search && (
        <>
          {isSearchLoading ? (
            <p>Searching...</p>
          ) : (
            <ul>
              {searchResults.map((todo) => (
                <li key={todo.id}>{todo.title}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <span>{todo.title}</span>

            <button
              disabled={isUpdatingTodo}
              onClick={() =>
                updateTodo({ id: todo.id, completed: !todo.completed })
              }
            >
              Toggle
            </button>

            <button
              disabled={isDeletingTodo}
              onClick={() => deleteTodo({ id: todo.id })}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
```

That’s it: keep clients in `config`, export named hooks from `hooks`, and call them from your components. Adjust invalidate logic (`queryClient.invalidateQueries`) or optimistic updates as you would with any React Query setup.
