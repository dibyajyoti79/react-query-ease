// Compiled on its own (see tsconfig.json here): module augmentation is global,
// so this check can't live next to the other tests.
import type { AxiosError } from "axios";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { createApiClient } from "../src";

declare module "@tanstack/react-query" {
  interface Register {
    defaultError: AxiosError<{ message: string }>;
  }
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
declare const assert: <_T extends true>() => void;

const api = createApiClient();
type QueryError = ReturnType<typeof api.useQuery<string>>["error"];
type MutationError = ReturnType<typeof api.useMutation<string>>["error"];
type OptionsError = Parameters<
  Extract<
    NonNullable<ReturnType<typeof api.queryOptions<string>>["throwOnError"]>,
    (...args: never[]) => unknown
  >
>[0];

assert<Equal<QueryError, AxiosError<{ message: string }> | null>>();
assert<Equal<MutationError, AxiosError<{ message: string }> | null>>();
assert<Equal<OptionsError, AxiosError<{ message: string }>>>();
// Same as TanStack's own hooks.
assert<Equal<QueryError, UseQueryResult<string>["error"]>>();
assert<Equal<MutationError, UseMutationResult<string>["error"]>>();
