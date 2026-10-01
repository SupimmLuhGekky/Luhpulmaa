/**
 * In-memory stand-in for `next/headers` so server code (sessions, rate-limit keys,
 * audit metadata) can run outside a Next.js request. The setup file mocks
 * `next/headers` with this module; tests drive it through `requestContext`.
 */
export interface StoredCookie {
  name: string;
  value: string;
  options: { expires?: Date; httpOnly?: boolean; sameSite?: string; secure?: boolean; path?: string; maxAge?: number };
}

interface RequestState {
  jar: Map<string, StoredCookie>;
  headers: Map<string, string>;
}

const g = globalThis as unknown as { __harbourRequestState?: RequestState };
const state: RequestState = (g.__harbourRequestState ??= { jar: new Map(), headers: new Map() });

export const requestContext = {
  /** Starts a fresh "browser": no cookies, a fixed fictional client IP and user agent. */
  reset(ip = "203.0.113.10") {
    state.jar.clear();
    state.headers.clear();
    state.headers.set("x-forwarded-for", `${ip}, 10.0.0.1`);
    state.headers.set("user-agent", "HarbourIntegrationTest/1.0");
  },
  setHeader(name: string, value: string | null) {
    if (value === null) state.headers.delete(name.toLowerCase());
    else state.headers.set(name.toLowerCase(), value);
  },
  cookie(name: string): StoredCookie | undefined {
    return state.jar.get(name);
  },
  setCookie(name: string, value: string) {
    state.jar.set(name, { name, value, options: {} });
  },
  clearCookies() {
    state.jar.clear();
  },
};

export async function cookies() {
  return {
    get(name: string) {
      const c = state.jar.get(name);
      return c ? { name: c.name, value: c.value } : undefined;
    },
    getAll() {
      return [...state.jar.values()].map((c) => ({ name: c.name, value: c.value }));
    },
    has(name: string) {
      return state.jar.has(name);
    },
    set(name: string, value: string, options: StoredCookie["options"] = {}) {
      state.jar.set(name, { name, value, options });
    },
    delete(name: string) {
      state.jar.delete(name);
    },
  };
}

export async function headers() {
  return new Headers([...state.headers.entries()]);
}

export async function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} };
}
