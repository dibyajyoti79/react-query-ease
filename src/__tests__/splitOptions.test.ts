import { describe, expect, it } from "vitest";
import { splitOptions } from "../internal/splitOptions";

describe("splitOptions", () => {
  it("keeps React Query options out of the Axios config", () => {
    const { axiosConfig } = splitOptions({
      url: "/todos",
      enabled: false,
      staleTime: 1000,
      select: () => 1,
      retry: 2,
      onError: () => {},
    });
    expect(axiosConfig).toEqual({ url: "/todos" });
  });

  it("keeps Axios options out of the React Query options", () => {
    const { reactQueryOptions } = splitOptions({
      url: "/todos",
      headers: { A: "1" },
      timeout: 10,
      params: { page: 1 },
      staleTime: 1000,
    });
    expect(reactQueryOptions).toEqual({ staleTime: 1000 });
  });

  it("forwards unknown keys to both sides, as in 0.3.x", () => {
    const { axiosConfig, reactQueryOptions } = splitOptions({ custom: 1 });
    expect(axiosConfig).toEqual({ custom: 1 });
    expect(reactQueryOptions).toEqual({ custom: 1 });
  });
});
