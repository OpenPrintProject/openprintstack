// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import createFetchClient, { type Client, type Middleware } from "openapi-fetch";
import createQueryHooks, { type OpenapiQueryClient } from "openapi-react-query";

import { apiError, unexpectedResponse } from "./errors.ts";
import type { paths } from "./schema.gen.ts";

// The REST API, typed from the server's OpenAPI spec:
//
//   api.client   openapi-fetch: `await api.client.GET("/api/printers")`
//   api.query    openapi-react-query: TanStack Query hooks and query options
//
// Every error answer carries an ApiError body (errors.ts). A 401 that means
// the session is gone (setup_required: no user yet; unauthenticated: not
// logged in) calls `onSignedOut`, which sends the browser to /setup or
// /login. The session check itself (GET /api/auth/me) is the exception: the
// route guards and the realtime client that ask it act on the answer
// themselves.

/** Why a 401 says the session is gone, and so which page to show. */
export type SignedOutReason = "setup_required" | "unauthenticated";

/** The session check, whose 401s its callers handle. */
export const SESSION_PATH = "/api/auth/me";

export type Api = {
  client: Client<paths>;
  query: OpenapiQueryClient<paths>;
};

export type ApiOptions = {
  /** The server's origin: the page's own, since Vite proxies /api in dev. */
  baseUrl: string;
  /** For tests. */
  fetch?: typeof fetch;
  /** A request (other than the session check) found the session gone. */
  onSignedOut: (reason: SignedOutReason) => void;
};

export function createApi(options: ApiOptions): Api {
  const client = createFetchClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch !== undefined && { fetch: options.fetch }),
  });
  client.use(errorBodies(), signedOut(options.onSignedOut));
  return { client, query: createQueryHooks(client) };
}

/** The reason in a 401's ApiError body, if it says the session is gone. */
export function signedOutReason(error: unknown): SignedOutReason | undefined {
  const code = apiError(error)?.code;
  return code === "setup_required" || code === "unauthenticated"
    ? code
    : undefined;
}

/** Gives every error answer that isn't an ApiError one that is. */
function errorBodies(): Middleware {
  return {
    async onResponse({ response }) {
      if (response.ok) return undefined;
      const body = await readJson(response.clone());
      if (apiError(body) !== undefined) return undefined;
      // Not the original's headers: its Content-Length: 0 is what makes
      // openapi-fetch ignore the body.
      return Response.json(unexpectedResponse(response.status), {
        status: response.status,
        statusText: response.statusText,
      });
    },
  };
}

function signedOut(onSignedOut: ApiOptions["onSignedOut"]): Middleware {
  return {
    async onResponse({ response, schemaPath }) {
      if (response.status !== 401 || schemaPath === SESSION_PATH) {
        return undefined;
      }
      const reason = signedOutReason(await readJson(response.clone()));
      if (reason !== undefined) onSignedOut(reason);
      return undefined;
    },
  };
}

/** The body as JSON, or undefined if it isn't JSON. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
