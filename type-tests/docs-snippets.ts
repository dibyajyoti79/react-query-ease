import { isAxiosError } from "axios";
import { QueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { createApiClient } from "../src";

type Todo = { id: number; title: string; completed: boolean; listId: string };
type ApiErrorBody = { message: string };
const api = createApiClient();
const queryClient = new QueryClient();
const todoQuery = (id: number) =>
  api.queryOptions<Todo>({ key: ["todo", id], url: `/todos/${id}` });

export const useA = () =>
  useInfiniteQuery({
    queryKey: ["todos", "infinite"],
    queryFn: ({ pageParam, signal }) =>
      api.get<{ items: Todo[]; next?: number }>("/todos", { params: { page: pageParam }, signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => last.next,
  });
queryClient.setQueryData<Todo>(todoQuery(1).queryKey, (old) => old && { ...old, completed: true });
export const useB = () =>
  api.useMutation<Todo, Error, { id: number }>({
    url: ({ id }) => `/todos/${id}`,
    method: "PATCH",
    keyToInvalidate: (todo, vars) => [["todos", vars.id], ["lists", todo.listId]],
  });
export const useC = () => {
  const q = api.useQuery({ key: "t", url: "/t", select: (t: Todo[]) => t.map((x) => x.title) });
  const s: string[] | undefined = q.data;
  return s;
};
export const d = (err: unknown) =>
  isAxiosError<ApiErrorBody>(err) ? err.response?.data.message ?? err.message : "x";
