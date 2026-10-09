// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

/**
 * A host name or IPv4 address (letters, digits, dots and hyphens), or an IPv6
 * address (hex digits with at least two colons). It refuses spaces, a scheme
 * such as http:// and a port, which the printer's address never has. The web
 * form checks it too, so it's a plain pattern.
 */
const HOST_PATTERN =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|[0-9A-Fa-f.]*:[0-9A-Fa-f.]*:[0-9A-Fa-f:.]*)$/;

/**
 * A CC2's settings. The UI renders them as a form, using each field's title
 * and description. The access code is write-only: the server never shows it
 * again. The last three are sent with every print started from here (PR 6).
 */
export const cc2SettingsSchema = z.object({
  host: z
    .string()
    .max(253)
    .regex(
      HOST_PATTERN,
      "Enter just the IP address or host name, with no spaces, http:// or port.",
    )
    .meta({
      title: "Address",
      description: "The printer's IP address or host name, e.g. 192.168.1.50.",
    }),
  accessCode: z.string().min(1).max(64).meta({
    title: "Access code",
    description:
      "The access code set on the printer's screen. Once saved, it's never shown again; leave it blank when editing to keep it.",
    writeOnly: true,
  }),
  autoBedLevel: z.boolean().default(true).meta({
    title: "Auto bed levelling",
    description:
      "Level the bed before each print started from here. It adds about 3 minutes.",
  }),
  timelapse: z.boolean().default(false).meta({
    title: "Timelapse",
    description: "Record a timelapse video of each print started from here.",
  }),
  bedSide: z.enum(["A", "B"]).default("A").meta({
    title: "Build plate side",
    description:
      "The side of the build plate facing up, as marked on the plate.",
  }),
});

export type Cc2Settings = z.output<typeof cc2SettingsSchema>;
