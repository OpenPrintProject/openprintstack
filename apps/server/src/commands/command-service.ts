// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { callForCommand } from "@openprintstack/driver-sdk";
import {
  COMMAND_POLICY,
  type Capabilities,
  type EventPayload,
  isOnline,
  type PrinterCommand,
  type PrinterState,
} from "@openprintstack/protocol";

import type { EventBus } from "../bus/bus.ts";
import {
  CALL_TIMEOUT_MS,
  type HostCall,
  UPLOAD_TIMEOUT_MS,
} from "../drivers/host.ts";
import { newId } from "../ids.ts";
import type { Logger } from "../logger.ts";
import { type DataPaths, stagedFilePath } from "../paths.ts";
import {
  type PrinterService,
  PrinterServiceError,
} from "../printers/printer-service.ts";
import type { StateStore } from "../state/store.ts";
import { type CommandError, fromDriverError } from "./errors.ts";
import { checkSafety, list } from "./safety.ts";

// Runs one command against one printer, in the plan's order:
//
//   1. the printer exists (else PrinterServiceError printer_not_found, and no
//      events; PR 8 checks the session first)
//   2. publish command.requested
//   3. the per-printer lock: one command at a time, plus one upload at a time
//      (printer_busy; nothing waits)
//   4. the command is in the printer's capabilities (unsupported)
//   5. the printer is online, if the command needs it (printer_offline)
//   6. the status allows it, per COMMAND_POLICY (invalid_state)
//   7. the safety check (unsafe, file_too_large)
//   8. the driver call: 10 s, or 10 min for an upload
//   9. publish command.result, which follows every command.requested
//
// Steps 4–7 read the state store and are `checkCommand`, which PR 8's upload
// route also runs before it reads the body.

export type CommandRequest = {
  printerId: string;
  /** Already parsed with protocol's `PrinterCommand`. */
  command: PrinterCommand;
  userId: string;
};

/** What `command.result` carries, and what `execute` resolves with. */
export type CommandResult = EventPayload<"command.result">;

export type CommandServiceOptions = {
  printers: Pick<PrinterService, "has" | "call">;
  store: Pick<StateStore, "get">;
  bus: Pick<EventBus, "publish">;
  paths: DataPaths;
  logger: Logger;
  /** A monotonic clock in milliseconds. `performance.now` by default. */
  now?: () => number;
};

export class CommandService {
  readonly #printers: Pick<PrinterService, "has" | "call">;
  readonly #store: Pick<StateStore, "get">;
  readonly #bus: Pick<EventBus, "publish">;
  readonly #paths: DataPaths;
  readonly #logger: Logger;
  readonly #now: () => number;
  /** The locks held, as `<printerId> <lane>`. */
  readonly #locks = new Set<string>();

  constructor(options: CommandServiceOptions) {
    this.#printers = options.printers;
    this.#store = options.store;
    this.#bus = options.bus;
    this.#paths = options.paths;
    this.#logger = options.logger.child({ component: "commands" });
    this.#now = options.now ?? (() => performance.now());
  }

  /**
   * Runs the command and resolves with its result, which is also published as
   * `command.result`. Rejections are results too (`ok: false`); only an
   * unknown printer throws (`printer_not_found`, before any event).
   */
  async execute({
    printerId,
    command,
    userId,
  }: CommandRequest): Promise<CommandResult> {
    if (!this.#printers.has(printerId)) {
      throw new PrinterServiceError(
        "printer_not_found",
        `There is no printer ${printerId}.`,
      );
    }
    const started = this.#now();
    const commandId = newId();
    const envelope = {
      printerId,
      source: { kind: "user", userId },
      correlationId: commandId,
    } as const;
    this.#bus.publish({
      type: "command.requested",
      ...envelope,
      payload: { commandId, command },
    });

    const error = await this.#run(printerId, command);
    const durationMs = Math.round(this.#now() - started);
    const result: CommandResult =
      error === null
        ? { commandId, ok: true, durationMs }
        : { commandId, ok: false, error, durationMs };
    this.#bus.publish({ type: "command.result", ...envelope, payload: result });
    return result;
  }

  async #run(
    printerId: string,
    command: PrinterCommand,
  ): Promise<CommandError | null> {
    const upload = command.kind === "file.upload";
    const lock = `${printerId} ${upload ? "upload" : "command"}`;
    if (this.#locks.has(lock)) {
      return {
        code: "printer_busy",
        message: upload
          ? "Another upload to this printer is still running."
          : "Another command to this printer is still running.",
      };
    }
    this.#locks.add(lock);
    try {
      const refusal = checkCommand(this.#store.get(printerId)?.state, command);
      if (refusal !== null) return refusal;
      // callForCommand only makes command calls, never connect or dispose.
      const call = callForCommand(command, (id) =>
        stagedFilePath(this.#paths, id),
      ) as HostCall;
      await this.#printers.call(
        printerId,
        call,
        upload ? UPLOAD_TIMEOUT_MS : CALL_TIMEOUT_MS,
      );
      return null;
    } catch (error) {
      const failure = fromDriverError(error);
      if (failure.code === "internal") {
        this.#logger.error(
          { err: error, printerId, kind: command.kind },
          "A command failed unexpectedly",
        );
      }
      return failure;
    } finally {
      this.#locks.delete(lock);
    }
  }
}

/**
 * Steps 4–7: whether the printer, in this state, accepts the command. Returns
 * why not, or null. Without capabilities (only before a driver has started),
 * step 4 is skipped, and the online check refuses the command instead.
 */
export function checkCommand(
  state: PrinterState | undefined,
  command: PrinterCommand,
): CommandError | null {
  if (state === undefined) {
    return {
      code: "printer_offline",
      message: "The printer hasn't reported its state yet.",
    };
  }
  if (state.capabilities !== null) {
    const unsupported = checkSupported(command, state.capabilities);
    if (unsupported !== null) return unsupported;
  }
  const policy = COMMAND_POLICY[command.kind];
  if (policy.requiresOnline && !isOnline(state.status)) {
    return {
      code: "printer_offline",
      message:
        state.status === "connecting"
          ? "The printer is still connecting."
          : "The printer is offline.",
    };
  }
  if (!policy.allowedStatuses.includes(state.status)) {
    return {
      code: "invalid_state",
      message: `${command.kind} isn't allowed while the printer is ${state.status}.`,
    };
  }
  return checkSafety(command, state);
}

/** Step 4: whether the printer has the command and what it names. */
export function checkSupported(
  command: PrinterCommand,
  capabilities: Capabilities,
): CommandError | null {
  if (!capabilities.commands.includes(command.kind)) {
    return unsupported(`The printer doesn't support ${command.kind}.`);
  }
  switch (command.kind) {
    case "temperature.set": {
      const heater = capabilities.heaters.find(
        ({ id }) => id === command.heaterId,
      );
      if (heater === undefined) {
        return unsupported(`The printer has no heater "${command.heaterId}".`);
      }
      return heater.controllable
        ? null
        : unsupported(`The ${heater.label} only reports its temperature.`);
    }
    case "fan.set": {
      const fan = capabilities.fans.find(({ id }) => id === command.fanId);
      if (fan === undefined) {
        return unsupported(`The printer has no fan "${command.fanId}".`);
      }
      return fan.controllable
        ? null
        : unsupported(`The ${fan.label} fan only reports its speed.`);
    }
    case "extension.invoke":
      return capabilities.extensions.includes(command.extension)
        ? null
        : unsupported(`The printer has no "${command.extension}" extension.`);
    case "file.upload": {
      const { upload, acceptedExtensions } = capabilities.files;
      if (!upload) {
        return unsupported("The printer doesn't take uploads.");
      }
      // An empty list means the printer takes any file.
      const name = command.fileName.toLowerCase();
      const accepted =
        acceptedExtensions.length === 0 ||
        acceptedExtensions.some((extension) =>
          name.endsWith(extension.toLowerCase()),
        );
      return accepted
        ? null
        : unsupported(
            `The printer only takes ${list(acceptedExtensions, "or")} files.`,
          );
    }
    default:
      return null;
  }
}

function unsupported(message: string): CommandError {
  return { code: "unsupported", message };
}
