// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { toast } from "sonner";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { snapshotUrl, toastFailure } from "./api.ts";

describe("toastFailure", () => {
  function spy() {
    const error = vi.spyOn(toast, "error");
    onTestFinished(() => {
      error.mockRestore();
    });
    return error;
  }

  it("toasts what failed with the server's reason", () => {
    const error = spy();

    toastFailure("Couldn't pause the print", {
      error: { code: "printer_busy", message: "Another command is running." },
    });

    expect(error.mock.calls).toEqual([
      [
        "Couldn't pause the print",
        { description: "Another command is running." },
      ],
    ]);
  });

  it.each(["unauthenticated", "setup_required"])(
    "says nothing for %s: the page is going to the login or setup page",
    (code) => {
      const error = spy();

      toastFailure("Couldn't pause the print", {
        error: { code, message: "Log in first." },
      });

      expect(error).not.toHaveBeenCalled();
    },
  );
});

describe("snapshotUrl", () => {
  it("percent-encodes the ids and adds the version", () => {
    expect(snapshotUrl("p 1/2", "cam#1", 7)).toBe(
      "/api/printers/p%201%2F2/cameras/cam%231/snapshot?t=7",
    );
  });
});
