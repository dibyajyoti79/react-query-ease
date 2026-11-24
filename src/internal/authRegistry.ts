import type { AxiosInstance } from "axios";

/** Axios instances that already have the auth interceptor applied. */
const registry = new WeakSet<AxiosInstance>();

export const registerAuth = (instance: AxiosInstance) => {
  registry.add(instance);
};

export const hasAuth = (instance: AxiosInstance): boolean =>
  registry.has(instance);
