import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../createApiClient";
import { createMockAdapter, header } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const parse = (data: unknown) =>
  typeof data === "string" ? JSON.parse(data) : data;

const setup = () => {
  const { adapter, calls } = createMockAdapter(() => ({ data: "ok" }));
  return { api: createApiClient({ adapter }), calls };
};

describe("request helpers", () => {
  it("keeps the (url, config) form unchanged", async () => {
    const { api, calls } = setup();

    await expect(
      api.post("/todos", { data: { title: "x" }, headers: { "X-A": "1" } })
    ).resolves.toBe("ok");

    expect(calls[0].method).toBe("post");
    expect(parse(calls[0].data)).toEqual({ title: "x" });
    expect(header(calls[0], "X-A")).toBe("1");
  });

  it("accepts the Axios (url, data, config) form", async () => {
    const { api, calls } = setup();

    await api.post("/todos", { title: "x" }, { headers: { "X-A": "1" } });

    expect(parse(calls[0].data)).toEqual({ title: "x" });
    expect(header(calls[0], "X-A")).toBe("1");
  });

  it("accepts the Axios form with an undefined config", async () => {
    const { api, calls } = setup();

    await api.put("/todos/1", { title: "y" }, undefined);

    expect(calls[0].method).toBe("put");
    expect(parse(calls[0].data)).toEqual({ title: "y" });
  });

  it("lets the data argument win over config.data, like Axios", async () => {
    const { api, calls } = setup();

    await api.patch("/todos/1", { done: true }, { data: { done: false } });

    expect(calls[0].method).toBe("patch");
    expect(parse(calls[0].data)).toEqual({ done: true });
  });

  it("passes skipAuth and other config through the Axios form", async () => {
    const { api, calls } = setup();

    await api.post("/refresh", null, { skipAuth: true, timeout: 50 });

    expect(calls[0].skipAuth).toBe(true);
    expect(calls[0].timeout).toBe(50);
  });

  it("keeps get and delete as (url, config)", async () => {
    const { api, calls } = setup();

    await api.get("/todos", { params: { page: 2 } });
    await api.delete("/todos", { data: { ids: [1] } });

    expect(calls[0].params).toEqual({ page: 2 });
    expect(parse(calls[1].data)).toEqual({ ids: [1] });
  });

  it("warns once when a body is passed as the config, without changing behaviour", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { api, calls } = setup();

    // @ts-expect-error: a request body is not an Axios config
    await api.post("/todos", { title: "x" });
    // @ts-expect-error: same mistake again; the warning is only logged once
    await api.post("/todos", { title: "y" });

    expect(calls[0].data).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("api.post(url, data, config)");
  });

  it("warns when FormData is passed as the config", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { api } = setup();

    // @ts-expect-error: FormData is not an Axios config
    await api.put("/upload", new FormData());

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn for a real config or an empty one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { api } = setup();

    await api.patch("/todos/1", { data: { done: true } });
    await api.patch("/todos/1", {});
    await api.patch("/todos/1");

    expect(warn).not.toHaveBeenCalled();
  });
});
