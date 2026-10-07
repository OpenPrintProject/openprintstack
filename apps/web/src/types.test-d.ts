// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  ApiError,
  OpsEvent,
  PrinterSnapshot,
  SessionUser,
} from "@openprintstack/protocol";
import { describe, expectTypeOf, it } from "vitest";

import type { components, paths } from "./api/schema.gen.ts";
import type { RealtimeSocket } from "./realtime/client.ts";
import type { PrinterData } from "./realtime/cache.ts";
import type { useFleet, usePrinter } from "./realtime/provider.tsx";
import type { FakeWebSocket } from "./test/fake-socket.ts";

type Schemas = components["schemas"];

describe("the realtime client's socket", () => {
  it("is what the browser's WebSocket is", () => {
    expectTypeOf<WebSocket>().toExtend<RealtimeSocket>();
  });

  it("is what the tests' fake is", () => {
    expectTypeOf<FakeWebSocket>().toExtend<RealtimeSocket>();
  });
});

describe("the REST types (from openapi.json) and protocol's", () => {
  it("agree on the shapes both carry", () => {
    expectTypeOf<Schemas["PrinterSnapshot"]>().toEqualTypeOf<PrinterSnapshot>();
    expectTypeOf<Schemas["OpsEvent"]>().toEqualTypeOf<OpsEvent>();
    expectTypeOf<Schemas["ApiError"]>().toEqualTypeOf<ApiError>();
    expectTypeOf<Schemas["SessionUser"]>().toEqualTypeOf<SessionUser>();
  });

  it("type the session check's answer", () => {
    expectTypeOf<
      paths["/api/auth/me"]["get"]["responses"][200]["content"]["application/json"]
    >().toEqualTypeOf<{ user: SessionUser }>();
  });
});

describe("the realtime hooks", () => {
  it("give the fleet, or undefined until its snapshot", () => {
    expectTypeOf<ReturnType<typeof useFleet>>().toEqualTypeOf<
      PrinterSnapshot[] | undefined
    >();
  });

  it("give a printer, null if there's no such printer, or undefined until its snapshot", () => {
    expectTypeOf<ReturnType<typeof usePrinter>>().toEqualTypeOf<
      PrinterData | undefined
    >();
    expectTypeOf<PrinterData>().toEqualTypeOf<PrinterSnapshot | null>();
  });
});
