// SPDX-FileCopyrightText: 2026 Open Print Stack contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSocket, type Socket as UdpSocket } from "node:dgram";
import {
  type AddressInfo,
  createServer,
  type Server,
  type Socket,
} from "node:net";

import {
  Aedes,
  type AedesPublishPacket,
  type AuthenticateError,
  type Client,
} from "aedes";

import {
  type JsonObject,
  METHOD,
  MQTT_USERNAME,
  parsePayload,
} from "../protocol.ts";
import { mergeStatus } from "../status-feed.ts";

// A CC2 for tests, on loopback: an MQTT broker (aedes) with a simulated
// printer behind it, and a UDP responder for the serial-number query. It
// speaks the real wire protocol, as far as it's known:
//
// - Clients log in as `elegoo` with the access code; anything else is refused
//   (CONNACK 5, "not authorised").
// - A client registers on `api_register` and is answered on its request id's
//   `register_response` topic: "ok", or "too many clients" once `maxClients`
//   are registered. A registration ends when its connection closes, or when
//   it hasn't sent a PING for `heartbeatTimeoutMs`.
// - Registered clients' PINGs get a PONG, and their requests an answer on
//   their `api_response` topic: 1002 the full status, 1046 a file's details,
//   anything else error 1001 (unknown method).
// - Status changes go to every client on `api_status` as deltas (event 6000)
//   with consecutive ids.
// - Every client's requests and registrations are passed on to the others, as
//   the plan says the printer does ("echoes").
//
// Commands, uploads, the camera and CANVAS come in later PRs.

export type FakeCc2Options = {
  readonly serial?: string;
  readonly accessCode?: string;
  readonly name?: string;
  readonly model?: string;
  /** What the serial-number reply says. Default: true for both. */
  readonly lanOnly?: boolean;
  readonly accessCodeSet?: boolean;
  /** How many clients may register at once. Default: 4. */
  readonly maxClients?: number;
  /** A client without a PING for this long is dropped. Default: 65 s. */
  readonly heartbeatTimeoutMs?: number;
  /** The full status to start with. Default: `idleStatus()`. */
  readonly status?: JsonObject;
  /** Layer counts by file name, for file details (1046). */
  readonly fileLayers?: Readonly<Record<string, number>>;
};

/** A request a registered client sent. */
export type FakeRequest = {
  readonly clientId: string;
  readonly id: number;
  readonly method: number;
  readonly params: unknown;
};

export const FAKE_SERIAL = "F01FAKECC2000001";
export const FAKE_ACCESS_CODE = "fake-code";
export const FAKE_NAME = "Fake CC2";
export const FAKE_MODEL = "Centauri Carbon 2";

const HOST = "127.0.0.1";

/** An idle CC2's full status, shaped like the real one's. */
export function idleStatus(): JsonObject {
  return {
    machine_status: {
      status: 1,
      sub_status: 0,
      exception_status: [],
      progress: 0,
    },
    print_status: {
      filename: "",
      uuid: "",
      current_layer: 0,
      total_layer: 0,
      print_duration: 0,
      total_duration: 0,
      remaining_time_sec: 0,
      progress: 0,
    },
    extruder: {
      temperature: 26.4,
      target: 0,
      filament_detect_enable: 1,
      filament_detected: 1,
    },
    heater_bed: { temperature: 25.1, target: 0 },
    ztemperature_sensor: {
      temperature: 27,
      measured_max_temperature: 0,
      measured_min_temperature: 0,
    },
    fans: {
      fan: { speed: 0, rpm: 0 },
      aux_fan: { speed: 0, rpm: 0 },
      box_fan: { speed: 0, rpm: 0 },
      heater_fan: { speed: 0, rpm: 0 },
      controller_fan: { speed: 255, rpm: 4000 },
    },
    led: { status: 1 },
    gcode_move_inf: { x: 0, y: 0, z: 0, e: 0, speed: 0, speed_mode: 1 },
    toolhead: { homed_axes: "" },
    external_device: { camera: true, u_disk: false, type: "0303" },
  };
}

type Registration = {
  readonly client: Client;
  lastPingAt: number;
};

export class FakeCc2 {
  readonly host = HOST;
  readonly serial: string;
  readonly name: string;
  readonly model: string;
  readonly ports: { readonly mqtt: number; readonly udp: number };

  /** The access code clients must log in with. */
  accessCode: string;
  /** What the serial-number reply says. */
  lanOnly: boolean;
  accessCodeSet: boolean;
  maxClients: number;
  /** Whether it answers PINGs. */
  answerPings = true;
  /** Whether it answers the serial-number query. */
  answerUdp = true;
  /** Every request a registered client sent, in order (PINGs left out). */
  readonly requests: FakeRequest[] = [];
  /** Every client id that registered, in order. */
  readonly registered: string[] = [];

  readonly #broker: Aedes;
  readonly #mqtt: Server;
  readonly #udp: UdpSocket;
  readonly #sockets = new Set<Socket>();
  readonly #clients = new Set<Client>();
  readonly #registrations = new Map<string, Registration>();
  readonly #fileLayers: Readonly<Record<string, number>>;
  readonly #heartbeatTimeoutMs: number;
  readonly #sweeper: ReturnType<typeof setInterval>;
  #status: JsonObject;
  #nextEventId = 1;
  #lose = 0;
  #silent = false;
  #down = false;
  /** Slots taken by clients that aren't connected here (e.g. "the slicer"). */
  #occupied = 0;

  private constructor(
    broker: Aedes,
    mqtt: Server,
    udp: UdpSocket,
    options: FakeCc2Options,
  ) {
    this.#broker = broker;
    this.#mqtt = mqtt;
    this.#udp = udp;
    this.serial = options.serial ?? FAKE_SERIAL;
    this.name = options.name ?? FAKE_NAME;
    this.model = options.model ?? FAKE_MODEL;
    this.accessCode = options.accessCode ?? FAKE_ACCESS_CODE;
    this.lanOnly = options.lanOnly ?? true;
    this.accessCodeSet = options.accessCodeSet ?? true;
    this.maxClients = options.maxClients ?? 4;
    this.#heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 65_000;
    this.#fileLayers = options.fileLayers ?? {};
    this.#status = options.status ?? idleStatus();
    this.ports = {
      mqtt: (mqtt.address() as AddressInfo).port,
      udp: udp.address().port,
    };
    this.#sweeper = setInterval(() => this.#sweep(), 100);
  }

  /** Starts a fake printer on loopback, on free ports. */
  static async start(options: FakeCc2Options = {}): Promise<FakeCc2> {
    const broker = await Aedes.createBroker();
    const mqtt = createServer();
    const udp = createSocket("udp4");
    await Promise.all([
      new Promise<void>((resolve) => mqtt.listen(0, HOST, resolve)),
      new Promise<void>((resolve) => udp.bind(0, HOST, resolve)),
    ]);
    const fake = new FakeCc2(broker, mqtt, udp, options);
    fake.#listen();
    return fake;
  }

  /** The printer's current full status. */
  get status(): JsonObject {
    return this.#status;
  }

  /** How many MQTT clients are connected now, registered or not. */
  get connections(): number {
    return this.#clients.size;
  }

  /** The ids of the clients registered now. */
  get clients(): string[] {
    return [...this.#registrations.keys()];
  }

  /**
   * Changes the status, and sends the change to every client as a delta
   * (event 6000), unless it's been told to lose it.
   */
  update(delta: JsonObject): void {
    this.#status = mergeStatus(this.#status, delta);
    const id = this.#nextEventId++;
    if (this.#lose > 0) {
      this.#lose -= 1;
      return;
    }
    if (this.#silent) return;
    this.#publish(`elegoo/${this.serial}/api_status`, {
      id,
      method: METHOD.statusEvent,
      result: { error_code: 0, ...delta },
    });
  }

  /**
   * Loses the next `count` deltas on the way: the status still changes, but
   * no client hears of it, so the next delta's id skips.
   */
  loseDeltas(count: number): void {
    this.#lose += count;
  }

  /**
   * Stops answering anything (PINGs, requests, registrations, deltas) while
   * keeping connections open, as a printer whose network hangs; or answers
   * again.
   */
  setSilent(silent: boolean): void {
    this.#silent = silent;
  }

  /**
   * Takes `count` places as if other apps had registered, e.g. to make the
   * printer report "too many clients".
   */
  occupy(count: number): void {
    this.#occupied = count;
  }

  /**
   * Goes down (closing every connection and refusing new ones, and not
   * answering UDP), as a printer that's switched off; or comes back up.
   */
  setDown(down: boolean): void {
    this.#down = down;
    if (down) {
      this.dropConnections();
    }
  }

  /** Closes every client's connection, as a reboot does. */
  dropConnections(): void {
    this.#registrations.clear();
    for (const socket of this.#sockets) {
      socket.destroy();
    }
  }

  /** Sends a message to every client on `topic`, as the broker would. */
  publish(topic: string, message: unknown): void {
    this.#publish(topic, message);
  }

  async close(): Promise<void> {
    clearInterval(this.#sweeper);
    this.dropConnections();
    await Promise.all([
      new Promise<void>((resolve) => this.#broker.close(() => resolve())),
      new Promise<void>((resolve) => this.#mqtt.close(() => resolve())),
      new Promise<void>((resolve) => this.#udp.close(() => resolve())),
    ]);
  }

  #listen(): void {
    this.#broker.authenticate = (_client, username, password, done) => {
      if (
        username === MQTT_USERNAME &&
        password?.toString() === this.accessCode
      ) {
        done(null, true);
        return;
      }
      const error = new Error("Not authorised") as AuthenticateError;
      error.returnCode = 5;
      done(error, null);
    };

    this.#mqtt.on("connection", (socket) => {
      if (this.#down) {
        socket.destroy();
        return;
      }
      this.#sockets.add(socket);
      socket.on("close", () => this.#sockets.delete(socket));
      // A client may reset its connection; that's not the fake's problem.
      socket.on("error", () => undefined);
      this.#broker.handle(socket);
    });

    this.#broker.on("client", (client) => this.#clients.add(client));
    this.#broker.on("clientDisconnect", (client) => this.#forget(client));
    this.#broker.on("clientError", (client) => this.#forget(client));
    this.#broker.on("publish", (packet, client) => {
      if (client !== null) this.#onPublish(packet, client);
    });

    this.#udp.on("message", (message, from) => {
      const query = parsePayload(message) as { method?: unknown } | undefined;
      if (this.#down || !this.answerUdp || query?.method !== METHOD.discovery) {
        return;
      }
      const reply = JSON.stringify({
        id: 0,
        result: {
          host_name: this.name,
          machine_model: this.model,
          sn: this.serial,
          token_status: this.accessCodeSet ? 1 : 0,
          lan_status: this.lanOnly ? 1 : 0,
        },
      });
      this.#udp.send(reply, from.port, from.address);
    });
  }

  #onPublish(packet: AedesPublishPacket, client: Client): void {
    const parts = packet.topic.split("/");
    if (parts[0] !== "elegoo" || parts[1] !== this.serial) return;
    const message = parsePayload(packet.payload) as JsonObject | undefined;

    if (parts.length === 3 && parts[2] === "api_register") {
      this.#echo(packet, client);
      this.#register(client, message);
    } else if (parts.length === 4 && parts[3] === "api_request") {
      this.#echo(packet, client);
      this.#request(parts[2] ?? "", message);
    }
  }

  #register(client: Client, message: JsonObject | undefined): void {
    const clientId = message?.client_id;
    const requestId = message?.request_id;
    if (typeof clientId !== "string" || typeof requestId !== "string") return;
    if (this.#silent) return;

    const full =
      !this.#registrations.has(clientId) &&
      this.#registrations.size + this.#occupied >= this.maxClients;
    if (!full) {
      this.#registrations.set(clientId, { client, lastPingAt: Date.now() });
      this.registered.push(clientId);
    }
    this.#publish(`elegoo/${this.serial}/${requestId}/register_response`, {
      client_id: clientId,
      error: full ? "too many clients" : "ok",
    });
  }

  #request(clientId: string, message: JsonObject | undefined): void {
    const registration = this.#registrations.get(clientId);
    if (registration === undefined || message === undefined || this.#silent) {
      return;
    }
    const answer = (reply: unknown) =>
      this.#publish(`elegoo/${this.serial}/${clientId}/api_response`, reply);

    if (message.type === "PING") {
      registration.lastPingAt = Date.now();
      if (this.answerPings) answer({ type: "PONG" });
      return;
    }
    const { id, method, params } = message;
    if (typeof id !== "number" || typeof method !== "number") return;
    this.requests.push({ clientId, id, method, params });

    switch (method) {
      case METHOD.getStatus:
        answer({ id, method, result: { error_code: 0, ...this.#status } });
        return;
      case METHOD.getFileDetail: {
        const filename = (params as { filename?: unknown } | undefined)
          ?.filename;
        const layers =
          typeof filename === "string" ? this.#fileLayers[filename] : undefined;
        answer({
          id,
          method,
          result:
            layers === undefined
              ? { error_code: 1021 }
              : { error_code: 0, filename, layer: layers },
        });
        return;
      }
      default:
        answer({ id, method, result: { error_code: 1001 } });
    }
  }

  /** Passes a client's request or registration on to every other client. */
  #echo(packet: AedesPublishPacket, from: Client): void {
    for (const client of this.#clients) {
      if (client !== from && client.connected) {
        client.publish(
          {
            cmd: "publish",
            topic: packet.topic,
            payload: packet.payload,
            qos: 0,
            retain: false,
            dup: false,
          },
          () => undefined,
        );
      }
    }
  }

  #publish(topic: string, message: unknown): void {
    this.#broker.publish(
      {
        cmd: "publish",
        topic,
        payload: Buffer.from(JSON.stringify(message)),
        qos: 0,
        retain: false,
        dup: false,
      },
      () => undefined,
    );
  }

  /** Ends a client's registration when its connection goes. */
  #forget(client: Client): void {
    this.#clients.delete(client);
    for (const [clientId, registration] of this.#registrations) {
      if (registration.client === client) {
        this.#registrations.delete(clientId);
      }
    }
  }

  /** Drops clients that have stopped sending PINGs. */
  #sweep(): void {
    const now = Date.now();
    for (const [clientId, registration] of this.#registrations) {
      if (now - registration.lastPingAt > this.#heartbeatTimeoutMs) {
        this.#registrations.delete(clientId);
        registration.client.close();
      }
    }
  }
}
