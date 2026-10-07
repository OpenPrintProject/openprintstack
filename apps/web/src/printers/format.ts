// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// How printer readings read in the UI. Units are protocol's: °C, mm, seconds
// and percent. A null reading means the printer doesn't report it, never 0,
// so it shows as a dash.

/** What a reading the printer doesn't report shows as. */
export const NOT_REPORTED = "—";

const oneDecimal = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 1,
});
const twoDecimals = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 2,
});
const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

/** "214.6 °C", or "—". */
export function formatTemperature(celsius: number | null): string {
  return celsius === null ? NOT_REPORTED : `${oneDecimal.format(celsius)} °C`;
}

/** "42 %" (speed may be above 100), or "—". */
export function formatPercent(percent: number | null): string {
  return percent === null ? NOT_REPORTED : `${whole.format(percent)} %`;
}

/** "120.5 mm". */
export function formatMm(mm: number): string {
  return `${twoDecimals.format(mm)} mm`;
}

/**
 * "45 s", "3 min 20 s", "1 h 2 min 5 s": whole seconds, leaving out the
 * larger units that are zero. "—" if not reported.
 */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return NOT_REPORTED;
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours} h ${minutes} min ${rest} s`;
  if (minutes > 0) return `${minutes} min ${rest} s`;
  return `${rest} s`;
}

const UNITS = ["B", "kB", "MB", "GB", "TB"] as const;

/** "512 B", "1.2 MB" (powers of 1000, as macOS shows sizes), or "—". */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return NOT_REPORTED;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const number = unit === 0 ? whole.format(value) : oneDecimal.format(value);
  return `${number} ${UNITS[unit]}`;
}

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** "7 Oct 2026, 14:05" in the browser's time zone, or "—". */
export function formatDateTime(iso: string | null): string {
  return iso === null ? NOT_REPORTED : dateTime.format(new Date(iso));
}

const dateTimeSeconds = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "medium",
});

/** "7 Oct 2026, 14:05:32" in the browser's time zone. */
export function formatDateTimeSeconds(iso: string): string {
  return dateTimeSeconds.format(new Date(iso));
}
