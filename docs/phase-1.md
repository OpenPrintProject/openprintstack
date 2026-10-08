# Phase 1: Printer support and setup, implementation plan

## Context

The development plan's Phase 1 has three parts:

- **Multi-brand support.** Each brand is a driver module behind the Phase 0 interface.
- **Auto-discovery.** Find printers on the network and ask only for what can't be read.
- **One-click install.** An installer, an embedded web server and database, and a first-run wizard in the browser.

Phase 0 built the driver interface, the event bus, the data model and the web shell, and proved them with a simulated printer. Phase 1 connects real printers.

It changes the development plan in one way: **the first driver is the Elegoo Centauri Carbon 2 (CC2) with CANVAS.** It isn't in the development plan, but it's the printer available for hardware testing, so it proves the interface on a real machine before anything else is built on top. The development plan's four brands follow it: Bambu Lab, PrusaLink, Klipper (through Moonraker) and OctoPrint. They're built from published documentation, tested against fake printers, and labelled **experimental** until someone confirms them on real hardware.

When Phase 1 is done, you can:

- install it on an Apple Silicon Mac or an x64 Windows PC with a downloaded installer, after which it runs as a background service from boot
- go through a first-run wizard in the browser: admin account, network access, storage, update check and finding printers
- find printers on the network and add them, typing only what can't be read (access codes, API keys)
- monitor and control a CC2: live status, uploads and prints, pause, resume and cancel, temperatures, fans, homing and jogging, camera snapshots, and its CANVAS trays
- add Bambu, PrusaLink, Moonraker and OctoPrint printers through experimental drivers

Every decision below was agreed during planning on 2026-10-07. Protocol, packaging and library facts were checked against primary sources on the same day (see [Sources](#sources)). Anything those sources couldn't confirm is marked **to confirm**, with the PR that confirms it.

---

## Decisions

| Area              | Decision                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order             | **Elegoo CC2 → discovery → install → the other drivers.** Windows CI comes first of all, right after this plan.                                                                                                                                                                                                                                                         |
| First driver      | Elegoo Centauri Carbon 2 with CANVAS, on firmware **v02.01.00.00**.                                                                                                                                                                                                                                                                                                     |
| Other drivers     | Bambu Lab, PrusaLink, Moonraker and OctoPrint, in that order. Built from published docs, tested against fake printers, and labelled **experimental** in the UI and README until confirmed on hardware.                                                                                                                                                                  |
| Driver tests      | Each driver's tests run against an **in-process fake printer that speaks the real wire protocol**. Every driver passes the Phase 0 conformance kit against its fake.                                                                                                                                                                                                    |
| Hardware checks   | Each CC2 PR has a short manual checklist, which Rob runs on his CC2 **before merging**.                                                                                                                                                                                                                                                                                 |
| Reusing code      | Other projects' code is **reference only**. We write our own TypeScript and credit the projects in each driver's README. Projects without a licence are never read for code. Bambu's own certificates or keys are never used.                                                                                                                                           |
| Interface changes | When a driver needs the shared interface changed, a **separate PR lands first**, covering protocol, driver-sdk, server, simulator and UI, with no driver code in it.                                                                                                                                                                                                    |
| Secrets           | Settings fields can be **write-only**. The API reports only whether they're set; the edit form shows "•••• (leave blank to keep)". (Encryption at rest stays in Phase 8.)                                                                                                                                                                                               |
| Filament slots    | A generic, read-only readout of filament units and their slots (CANVAS trays, Bambu AMS), carried by its **own state event**, `printer.filament_changed`, which is kept forever.                                                                                                                                                                                        |
| CC2 connection    | Needs the printer's **LAN Only mode** (which turns off Elegoo's cloud and the Matrix app). The **access code is required**: a CC2 can't be added without one.                                                                                                                                                                                                           |
| CC2 printing      | **Per-printer defaults**, sent with every start: auto bed levelling **on**, timelapse **off**, bed side **A**. The printer chooses CANVAS trays itself; choosing trays yourself comes with Phase 6's slot mapping.                                                                                                                                                      |
| CC2 extras        | CANVAS trays are shown read-only. Light, speed mode and auto-refill wait for their planned phases.                                                                                                                                                                                                                                                                      |
| CC2 camera        | **On-demand snapshots:** open the stream, take one frame and close it at once, reporting "camera busy" if another app holds the printer's single viewer slot. Live view waits for Phase 2.                                                                                                                                                                              |
| Bambu             | Control needs the printer's **Developer Mode**. Without it the printer is added **monitor-only**, with a banner explaining why. TLS identity is **pinned on first connect**. Snapshots on P1 and A1 models only (X1, H2, P2S and X2D wait for Phase 2). Prints plate 1 with per-printer defaults and the AMS order the slicer saved. AMS trays fill the filament slots. |
| PrusaLink         | Printers with PrusaLink **built into their firmware** only (MK4/S, MK3.9, MK3.5, XL, MINI, CORE One). The Raspberry Pi app for MK3S/MK2.5 is left for later.                                                                                                                                                                                                            |
| OctoPrint         | Targets **1.11**, avoiding endpoints that 2.0 removes. A 2.0 check comes once 2.0 is final. The API key comes from the **Application Keys approval flow**, with a paste field as fallback.                                                                                                                                                                              |
| Discovery         | **On demand** (about 10 s, from "Find printers" or the wizard). How to find each brand **lives in its driver**; a generic discovery service in the server runs it.                                                                                                                                                                                                      |
| Subnet scan       | **Opt-in** ("Scan my network"), limited to the server's own subnets.                                                                                                                                                                                                                                                                                                    |
| Address changes   | **Updated automatically** when an added printer reappears at a new address with the same identity (e.g. serial number). The server looks for it **only while it's offline**.                                                                                                                                                                                            |
| Platforms         | **macOS on Apple Silicon** and **Windows x64**. No Linux and no Docker in Phase 1.                                                                                                                                                                                                                                                                                      |
| Packaging         | The **official Node runtime in a folder**, alongside our server bundle, the web app and the SQLite module. No single-executable build. **Unsigned** for now, but built so that signing can be added later.                                                                                                                                                              |
| Service           | A **background service that starts at boot**, system-wide, under a dedicated low-privilege account, with its data in a shared system folder.                                                                                                                                                                                                                            |
| macOS installer   | A `.pkg` built with Apple's `pkgbuild` and `productbuild`, running a LaunchDaemon as the `_openprintstack` role account.                                                                                                                                                                                                                                                |
| Windows installer | A setup `.exe` built with **Inno Setup**, running Node through the **shawl** service wrapper as `NT SERVICE\OpenPrintStack`.                                                                                                                                                                                                                                            |
| Firewall          | The Windows installer adds two rules for **all network profiles, limited to the local subnet**: TCP 7337 in, and UDP in for Node. The server's own network setting still decides whether it listens on the network.                                                                                                                                                     |
| Config            | A **`config.toml`** in the data folder, which a **Settings page** edits. Environment variables still override it.                                                                                                                                                                                                                                                       |
| Network           | The **first-run wizard asks** "only this computer" or "any device on my network", explaining that it's plain HTTP until Phase 8.                                                                                                                                                                                                                                        |
| Host names        | With network access on, the server **automatically accepts this computer's own addresses**, its host name and `<hostname>.local`, plus any names listed in settings.                                                                                                                                                                                                    |
| Wizard            | Admin account → network access → storage and retention → update check → find printers.                                                                                                                                                                                                                                                                                  |
| Updates           | An **opt-in** daily check of GitHub Releases that shows a banner. Installing stays manual: download the new installer and run it over the old one.                                                                                                                                                                                                                      |
| Logs              | In service mode the server writes **rotating log files** in the data folder: daily, keeping 14. Running from source still logs to stdout.                                                                                                                                                                                                                               |
| Uninstall         | Removes the program and the service, and **keeps the data folder**.                                                                                                                                                                                                                                                                                                     |
| Releases          | Pushing a version tag builds both installers and attaches them to a **draft** GitHub Release, which Rob publishes. **v0.1.0-alpha.1** is published as a pre-release as soon as the installers work; **v0.1.0** comes at the end of Phase 1.                                                                                                                             |
| Old data          | The service **starts fresh** in its own system folder. Running from source keeps using the per-user folder, so the two never share a database.                                                                                                                                                                                                                          |
| Simulator         | **Builds from source only.** The installers leave it out.                                                                                                                                                                                                                                                                                                               |
| Identifier        | **`io.github.openprintproject.openprintstack`** for the macOS package and LaunchDaemon. Windows uses the service name `OpenPrintStack` and a fixed Inno Setup `AppId`.                                                                                                                                                                                                  |
| CI                | A **Windows test job on every PR**, alongside the existing Linux checks and macOS tests.                                                                                                                                                                                                                                                                                |
| Test machines     | Rob's dev Mac (macOS installer) and a Windows PC (Windows installer).                                                                                                                                                                                                                                                                                                   |
| Delivery          | One PR per step (list below). **PR 1 is this plan on its own**, so it can be reviewed before any code.                                                                                                                                                                                                                                                                  |

---

## Layout

New and changed parts of the repo:

```
packages/
  driver-elegoo-cc2/   Elegoo Centauri Carbon 2 + CANVAS: MQTT, chunked HTTP upload, MJPEG snapshot, UDP discovery
  driver-bambu/        experimental: MQTT over TLS, FTPS, JPEG camera (P1/A1), SSDP discovery
  driver-prusalink/    experimental: REST with Digest auth, polling, mDNS
  driver-moonraker/    experimental: WebSocket JSON-RPC + HTTP, HTTP probe, mDNS
  driver-octoprint/    experimental: REST + push socket, Application Keys, mDNS
apps/server/src/
  discovery/           the discovery service: UDP, mDNS, subnet scan, finding offline printers again
  config.ts            now layered: defaults < config.toml < OPS_* variables
packaging/
  stage.ts             assembles the runtime folder for one target
  macos/               pkg scripts, LaunchDaemon plist, uninstall.sh
  windows/             Inno Setup script, shawl
.github/workflows/
  ci.yml               + Windows test job, + installer jobs for packaging changes
  release.yml          tag → both installers → draft GitHub Release
docs/phase-1.md        this plan
```

Each driver package's fake printer is exported from `@openprintstack/driver-<type>/testing`, like the conformance kit, so nothing in the main entry loads test code. The proposed driver type names are `elegoo-cc2`, `bambu`, `prusalink`, `moonraker` and `octoprint`; they can still be changed in each driver's PR.

**Import boundaries** stay as in Phase 0. New driver packages follow the existing driver rules (no server, Hono or DB imports), and `drivers/registry.ts` is still the only server file that imports them. Discovery keeps to that rule: the discovery service gets each driver's discovery description through the registry.

---

## Core design

### Interface changes

Each one lands in its own PR before the first driver that needs it.

| Change                 | What it adds                                                                                                                                                                                                                                                                                                                                                                           | PR  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| Write-only settings    | A settings field marked `.meta({ writeOnly: true })` (a standard JSON Schema keyword) is never returned by the API. `GET /api/printers/{id}` lists `secretsSet` instead. An empty or missing value in an edit keeps the stored one. The logger redacts these fields too.                                                                                                               | 3   |
| Setup help             | `manifest.setupHelp`: short steps shown above the add form (e.g. how to switch on LAN Only and set an access code).                                                                                                                                                                                                                                                                    | 3   |
| Read-only heaters      | `Heater.controllable`, as fans already have, so a chamber sensor can be shown without being settable. Read-only heaters have `maxC: null`.                                                                                                                                                                                                                                             | 4   |
| Filament slots         | A `filament` driver message carrying every unit (`id`, `kind`, `label`) and its slots (`id`, `label`, `status` empty/loaded/active, `material`, `name`, `colorHex`, nozzle range). It's always nullable: `null` means not reported. The host publishes `printer.filament_changed` (state category) only when something actually changed, and `PrinterState.filament` holds the latest. | 4   |
| Identity and discovery | An `identity` driver message (e.g. a serial number), stored on the printer record, and `DriverModule.discovery`, which describes how a brand is found (see [Discovery](#discovery)).                                                                                                                                                                                                   | 8   |
| Experimental label     | `manifest.maturity`: `stable` or `experimental`, shown as a badge on the add form and the printer page.                                                                                                                                                                                                                                                                                | 20  |
| Notices                | `Capabilities.notices`: lasting explanations shown as banners (e.g. "Developer Mode is off: monitoring only"). Each can carry one action button that runs a driver extension action (e.g. "Trust new certificate").                                                                                                                                                                    | 20  |
| Passive UDP discovery  | A discovery method that listens on a UDP port for announcements (Bambu).                                                                                                                                                                                                                                                                                                               | 20  |
| mDNS and HTTP probes   | Discovery methods that browse mDNS service types and probe hosts over HTTP during a subnet scan.                                                                                                                                                                                                                                                                                       | 23  |
| Setup actions          | `DriverModule.setupActions`: named actions the add form can run before a printer exists (OctoPrint's "Request access").                                                                                                                                                                                                                                                                | 26  |

### Discovery

**Driver side.** `DriverModule.discovery` describes how to find the brand. It declares:

- which settings field holds the printer's address, so the server can fill it in and update it later
- one or more methods, each with a pure `parse` that turns what came back into a **found printer**:
  - `udp-broadcast`: send a payload to a port and read the replies (CC2)
  - `udp-listen`: listen on ports for announcements (Bambu)
  - `mdns`: browse service types (PrusaLink, OctoPrint, Moonraker when it advertises)
  - `probe`: check one host during a subnet scan (the CC2 by unicast UDP, the HTTP brands by HTTP)

A found printer has a name, a model, an identity, the settings it could fill in (address, serial and so on), and the list of settings the user still has to give (an access code, an API key).

**Server side.** `apps/server/src/discovery/` does all the network I/O, so drivers stay free of sockets for discovery:

- It runs one socket per UDP port and one mDNS browser (`bonjour-service`, MIT, maintained) shared by every driver, plus HTTP probes with short timeouts and a cap on how many run at once.
- It marks printers that are already added, by identity, or by address when there's no identity.
- When two drivers claim one device, a declared priority decides. This matters because Moonraker and the Prusa-Link Pi app both answer as "OctoPrint".
- Results stream to the browser over the WebSocket as a `discovery` topic, snapshot first and then each new find, as Phase 0's hub already does for other topics.
- One scan runs at a time. `POST /api/discovery` starts one (optionally with the subnet scan), and a second request while it runs answers 409.

**Subnet scan.** It's opt-in, and limited to the IPv4 subnets of the server's own interfaces, each /24 or smaller. It runs only the drivers' `probe` methods. The button explains that some routers and security tools flag scans.

**Finding offline printers again.** When an added printer with a known identity has been offline for a minute, the server searches for that printer only, about once a minute, using its driver's passive and broadcast methods (never a subnet scan). It stops when the printer comes back or is found.

If the printer turns up at a new address, the server:

1. updates the address setting
2. restarts the driver
3. publishes `printer.updated` and a new `printer.address_changed` event (config category) with the old and new address

### Elegoo Centauri Carbon 2 driver

The CC2 does **not** use the original Centauri Carbon's SDCP protocol. Elegoo hasn't published documentation for it. The references are Elegoo's own client library (`elegoo-link`, Apache-2.0) and the Home Assistant integration's protocol notes (MIT). The rest of this section is drawn from them.

**Connection**

- MQTT 3.1.1 over plain TCP to port 1883, username `elegoo`, password = the access code. Uses the `mqtt` package (MIT).
- Session setup:
  1. Register on `elegoo/<sn>/api_register` and wait up to 3 s for the reply.
  2. Subscribe to `elegoo/<sn>/api_status` and `elegoo/<sn>/<client_id>/api_response`.
  3. Send commands as `{id, method, params}` to `elegoo/<sn>/<client_id>/api_request`.
- A `PING` heartbeat every 10 s; the printer drops a client after 65 s without one.
- The serial number (`sn`) is needed for every topic. The driver asks the printer for it with a unicast UDP query to port 52700 (`{"id":0,"method":7000}`), so the add form needs only the address and the access code.
- The printer allows only **about 4 MQTT clients** at once, and the slicer and phone app count too. The driver keeps a single connection, disconnects cleanly, and on "too many clients" reports `offline` with that reason and retries with backoff.
- Replies on topics ending `/api_request` or `/api_register` are other clients' echoes, and are ignored.

**Status.** The driver asks for the full status (method 1002), then merges the deltas pushed as event 6000, about once a second. If delta ids skip 5 times in a row, it asks for the full status again. It also asks again after every reconnect.

Proposed status mapping, **to confirm on hardware in PR 5**:

| CC2 `machine_status.status`                                                                                                         | Our status                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1 idle                                                                                                                              | `idle`                                                             |
| 2 printing, with `sub_status` 1045/1405 (preheating)                                                                                | `preparing`                                                        |
| 2 printing, with `sub_status` 2075 / 2501 / 2502 / 2503                                                                             | `printing` / `pausing` / `paused` / `cancelling`                   |
| 0 init, 3/4 filament, 5 levelling, 6 PID, 7 resonance, 8 self-check, 9 updating, 10 homing, 11 file transfer, 12 video, 13 extruder | `busy`, with the activity as the detail                            |
| 14 emergency stop                                                                                                                   | `error`                                                            |
| 15 power-loss recovery                                                                                                              | to confirm                                                         |
| `exception_status` not empty                                                                                                        | to confirm (probably `error`, with the codes in the error message) |

**Job lifecycle.** A job starts when a new print `uuid` appears. It ends as `completed` (2077), `cancelled` (2504) or `failed` (an error during a print).

**Telemetry**

| Our field               | Comes from                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| Temperatures            | `extruder` and `heater_bed` (settable), plus `ztemperature_sensor` as a read-only chamber reading |
| Fans                    | `fan`, `aux_fan` and `box_fan` (settable); `heater_fan` and `controller_fan` (read-only)          |
| Position and homed axes | `gcode_move_inf` and `toolhead.homed_axes`                                                        |
| Speed                   | `speed_mode` 0–3, shown as 50/100/150/200 %                                                       |
| Job progress            | `print_status`; the total layer count comes from method 1046 when deltas leave it out             |

**Capabilities.** Heater limits and the build volume come from Elegoo's published specification for the CC2, cited in the driver. `maxMoveSpeedMmS` is `null`, because the CC2's move command takes no speed. Files: list and upload, `.gcode` only (the only format confirmed; others are left out until confirmed).

**Commands**

| Command        | CC2 method                                                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start print    | 1020, always sending the per-printer defaults (`printer_check`, `delay_video`, `print_layout`) and an empty `slot_map`, so the printer picks trays. `printer_check` is sent every time, because the printer otherwise reuses the last value it was given. |
| Pause / cancel | 1021 / 1022                                                                                                                                                                                                                                               |
| Resume         | 1023. The printer replies only once the resume has finished (reported at about 2 minutes). The driver resolves the command once the status shows the resume has begun, rather than waiting for the reply.                                                 |
| Home           | 1026                                                                                                                                                                                                                                                      |
| Move           | 1027, one axis per message, so a multi-axis jog is sent as consecutive messages                                                                                                                                                                           |
| Temperatures   | 1028 (nozzle and bed)                                                                                                                                                                                                                                     |
| Fans           | 1030 (the scale is to confirm in PR 6)                                                                                                                                                                                                                    |
| List files     | 1044                                                                                                                                                                                                                                                      |

Elegoo's own library leaves 1023 and 1026–1048 switched off, but community projects use them on stock firmware. That's why PR 6's hardware check covers every one. A busy printer answers error 1009, which maps to `invalid_state`.

**Upload.** `PUT http://<ip>/upload` in chunks of at most 1 MB:

- Each chunk carries `Content-Range`, `X-File-Name`, `X-File-MD5` (of the whole file) and `X-Token` (the access code).
- All chunks go over **one keep-alive connection** (a `node:http` Agent with one socket). New connections per chunk get HTTP 429.
- A failed chunk aborts the upload; it's never retried, because a retry corrupts the file.
- Phase 0's per-printer command lock already keeps uploads to one at a time.

**Camera.** The printer serves MJPEG on port 8080, with one viewer slot. A snapshot:

1. sends method 1042 (`enable`) if needed (to confirm)
2. connects, reads one JPEG frame and closes at once
3. on refusal or a timeout, fails with `printer_rejected` and the message "camera busy"

**CANVAS.** Method 2005 and the status's `canvas_info` give each CANVAS unit's 4 trays (brand, material, name, colour, nozzle range and status 0 empty / 1 loaded / 2 active). The driver turns them into the `filament` message.

**Settings**

| Setting        | Notes                              |
| -------------- | ---------------------------------- |
| `host`         | IP address or host name. Required. |
| `accessCode`   | Required and write-only.           |
| `autoBedLevel` | Default on.                        |
| `timelapse`    | Default off.                       |
| `bedSide`      | `A` or `B`. Default `A`.           |

The setup help explains turning on LAN Only and setting an access code on the printer, and that this disconnects Elegoo's cloud and the Matrix app.

**Discovery.** A UDP broadcast of `{"id":0,"method":7000}` to port 52700. The reply gives the host name, model, serial, whether an access code is set and whether LAN Only is on (the address is the reply's sender). A printer found with LAN Only off is listed with a note to switch it on.

**The fake CC2** (`@openprintstack/driver-elegoo-cc2/testing`) is made of:

- an in-process MQTT broker (`aedes`, MIT, maintained) with a simulated printer behind it
- an upload server that enforces the chunk and keep-alive rules, including the 429
- an MJPEG server with one viewer slot
- a UDP responder for discovery

### Experimental drivers

Each experimental driver has its own fake printer, passes the conformance kit, shows the experimental badge, and lists in its README what has and hasn't been confirmed on hardware.

**Bambu Lab** (PRs 21–22)

- **Connection:**
  - MQTT over TLS on port 8883, user `bblp`, password = the LAN access code.
  - Subscribes to `device/<serial>/report`, sends one `pushall` on connect, and merges the deltas.
  - Keeps `sequence_id` a string within 0 to 2³¹−1.
- **TLS:** the printer's certificate names its serial, not its IP. On first connect the driver stores the certificate's fingerprint in its storage folder and refuses any other one afterwards. A changed certificate raises a notice with a "Trust new certificate" action.
- **Monitor-only:** the driver reads Developer Mode from the status flags (`print.fun` bit 29). When it's off, the capabilities list no control commands, and a notice explains how to switch Developer Mode on (and that it disconnects Bambu Cloud and Handy).
- **Files:** implicit FTPS on port 990 with `basic-ftp` (MIT, ≥ 6.2.2, which reuses TLS sessions on data connections), TLS capped at 1.2, passive mode only.
  - Storage is the SD card on X1, P1, A1 and A2L, and USB on H2, P2S and X2D.
  - The driver only accepts sliced `.gcode.3mf` files.
- **Print start:** `project_file` with plate 1 and the per-printer defaults (bed levelling, flow calibration, timelapse, use AMS), keeping the AMS order the slicer saved.
- **Camera:** P1 and A1 models send one JPEG over TLS on port 6000 after an 80-byte login. Other models report no snapshot until Phase 2.
- **AMS** trays fill the filament slots. **HMS** error codes become alerts.
- **Discovery:** listens for the SSDP announcements on UDP 2021 and 1990, which give the address, serial, model, name and connection mode.
- **The fake** is an `aedes` broker over TLS with a self-signed certificate (CN = serial), a minimal implicit-FTPS server, a JPEG camera server and an SSDP announcer.

**PrusaLink** (PR 24)

- REST `/api/v1/*`, with HTTP Digest auth as user `maker` and the password the printer shows. The firmware's Digest has **no `qop`**, so the driver implements it itself (about 60 lines with `node:crypto`). Node's `fetch` has no Digest support.
- Polls `/api/v1/status` every 1–2 s, as there's no push channel.
- Job control: pause, resume and stop. Upload with `PUT /api/v1/files/usb/<name>`, file list from USB storage (8.3 short names).
- No jog, temperature, fan or camera control exists on firmware printers, so those capabilities are left out. Heaters are read-only.
- Discovery: mDNS `_prusalink._tcp`, and an HTTP probe recognising the `Digest realm="Printer API"` challenge.

**Moonraker** (PR 25)

- WebSocket JSON-RPC at `/websocket`: `server.connection.identify`, then `printer.objects.subscribe`, merging `notify_status_update` deltas. Klippy states and `print_stats.state` map to our statuses.
- Heaters, fans and the build volume are read from `printer.objects.list`, `heaters` and `toolhead.axis_minimum/maximum` after connecting.
- Controls go through `/printer/gcode/script`. Uploads use `/server/files/upload`. Snapshots use the webcam's `snapshot_url` from `/server/webcams/list`, which may be served by nginx on port 80 rather than by Moonraker.
- `GET /access/info` says whether a key is needed. Most installs trust the LAN, so the API key field is optional and only asked for when Moonraker requires it.
- Several instances on one host are told apart by port (7125, 7126 and so on).
- Discovery: Moonraker doesn't advertise by default, so it relies on the subnet scan's probe (`GET /server/info` on 7125, then 80). `_moonraker._tcp` is browsed for installs that turn on `[zeroconf]`.

**OctoPrint** (PR 27)

- REST with `X-Api-Key`.
- Push updates over the raw WebSocket at `/sockjs/websocket`, authenticated with a passive `/api/login` session. `current` and `event` messages drive the status. Note that `PrintFailed` with reason `cancelled` is a cancel.
- Controls: `/api/printer/printhead` (jog and home), `/tool` and `/bed`, `M106` through `/api/printer/command`, `/api/job` and `/api/files/local`.
- The build volume comes from the active printer profile. Users configure that profile themselves, so the driver says so in its README.
- Snapshots come from the default webcam's snapshot URL in `/api/settings`.
- The API key comes from the **Application Keys** flow:
  1. probe
  2. request, which returns a link to OctoPrint's approval page
  3. poll every second until approved, denied or timed out (the request endpoint is rate-limited)
  - A paste field is the fallback.
- Discovery: mDNS `_octoprint._tcp`, ignoring Moonraker and the Prusa-Link Pi app, which also advertise or answer as OctoPrint.

### Server config, network and wizard

**Config layers:** built-in defaults < `config.toml` in the data folder < `OPS_*` variables. The data folder itself can't come from the file, because the file lives in it; it comes from `OPS_DATA_DIR` or the default. Unknown keys or bad values stop the server with a message listing them all, as Phase 0 does for variables. Hand-editing the file is the recovery path if a setting locks you out.

| Section       | Keys                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------- |
| `[network]`   | `access` (`local` or `lan`), `port` and `allowed_hosts`. `OPS_HOST` still overrides `access`. |
| `[telemetry]` | `sample_interval_ms` and `retention_days`                                                     |
| `[updates]`   | `check` (default `false`)                                                                     |
| `[logging]`   | `level`                                                                                       |

The installer writes a commented template, parsed with `smol-toml` (BSD-3, maintained). The UI rewrites the file atomically, which drops hand-written comments; the Settings page says so.

**Service mode.** The service definitions set only `OPS_DATA_DIR` and `OPS_SERVICE=true`, so everything else stays editable in the file. Service mode means two things:

- Logs go to `logs/` in the data folder through `pino-roll` (MIT, from the pino project), rotated daily and kept for 14 days.
- A change that needs a restart (port, network access) is applied by shutting down gracefully and exiting, and the service manager starts the server again. Run from source, the Settings page asks you to restart it yourself instead.

**Settings API.** `GET /api/settings` and `PATCH /api/settings`. Retention, sampling, log level and the update check apply at once; network and port changes answer `restartRequired` and, in service mode, restart.

**Host names.** With `access = "lan"`, the Host check also accepts:

- this computer's interface addresses, read again whenever an unknown Host arrives
- `os.hostname()` and `<hostname>.local`
- the names in `allowed_hosts`

Whether `os.hostname()` matches the macOS Bonjour name is to confirm in PR 13.

**First-run wizard**

1. `/setup` creates the admin, as in Phase 0. Until then the server listens only on this computer, so only someone at it can do setup.
2. **Network access:** only this computer, or any device on the network, with the plain-HTTP warning. Choosing the network restarts the server; the wizard waits for it to come back.
3. **Storage and retention:** shows the data folder and edits telemetry retention and sampling.
4. **Update check:** off unless switched on, explaining that it contacts GitHub.
5. **Find printers:** the same component as the Find printers page.

Every step after the first can be skipped. Progress is stored in a small new `app_state` table, so the wizard picks up where it left off after the restart in step 2.

**Update check.** When it's on, the server checks once a day against `GET https://api.github.com/repos/OpenPrintProject/openprintstack/releases/latest`, or the newest pre-release when running a pre-release. A newer version shows a dismissable banner that links to the release. Nothing is downloaded.

**About.** An About page shows the version, the licence, the third-party notices and a **link to the source code**, which AGPL section 13 asks network services to offer.

### Packaging and installers

**Runtime folder** (`packaging/stage.ts`, run on each target's own CI runner):

1. Build the web app and the server **without the simulated driver**. A build flag removes it from the registry; source builds and the Phase 0 smoke test keep it.
2. Download the official Node binary for the exact pinned Node 26 version and check it against the release's `SHASUMS256.txt`. The macOS binary keeps its Node.js Foundation signature, and the Windows `node.exe` its OpenJS Foundation signature.
3. Copy the server bundle and its production dependencies, pruned to the target (better-sqlite3 13 ships prebuilt binaries for both targets, so nothing is compiled). The exact pnpm command is to confirm in PR 16.
4. Copy the web build, our licence, Node's licence and a generated notice file for every runtime dependency.

**macOS** (`.pkg`)

| What         | Where                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program      | `/Library/Application Support/io.github.openprintproject.openprintstack/app/`, owned root:wheel and read-only to the service                                                                                              |
| Data         | `…/data/`, owned by `_openprintstack`, mode 0700                                                                                                                                                                          |
| Service      | `/Library/LaunchDaemons/io.github.openprintproject.openprintstack.plist`, with `UserName _openprintstack`, `RunAtLoad` and `KeepAlive`                                                                                    |
| Service user | `_openprintstack`, a hidden role account created by the postinstall script with `dscl`. Its UID is a free one in 450–499, picked at install time and never hard-coded (Apple has taken new system UIDs in past releases). |

- **Upgrade:** preinstall stops the service (`launchctl bootout`) and removes the old `app/`. Postinstall creates the user if it's missing, fixes ownership, and starts the service (`launchctl bootstrap`). Data is never touched.
- **Uninstall:** an `uninstall.sh` in `app/` stops and removes the service, the program and the user, then runs `pkgutil --forget`. It keeps `data/`.
- **Unsigned install:** double-clicking the `.pkg` gives a Gatekeeper warning. You then go to System Settings → Privacy & Security → **Open Anyway**. The README documents that, and a Terminal alternative (`curl` then `sudo installer -pkg …`) that doesn't trigger the warning.

**Windows** (Inno Setup `.exe`)

| What     | Where                                                                                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program  | `C:\Program Files\OpenPrintStack\`                                                                                                                                                       |
| Data     | `C:\ProgramData\OpenPrintStack\`. Inheritance is removed; SYSTEM and Administrators get full control, and `NT SERVICE\OpenPrintStack` gets Modify.                                       |
| Service  | `OpenPrintStack`, started automatically at boot. shawl runs `node.exe` as `NT SERVICE\OpenPrintStack`; on stop it sends Ctrl-C, which the server already handles as a graceful shutdown. |
| Firewall | TCP 7337 in, and UDP in for `node.exe`, for all profiles, limited to the local subnet                                                                                                    |

- **Upgrade:** a fixed `AppId`. The installer stops the service, replaces the program and starts it again.
- **Uninstall:** removes the service, the firewall rules and the program, and keeps the data.
- **Unsigned install:** SmartScreen shows "Windows protected your PC" → More info → Run anyway. The README says so.
- Whether shawl restarts the service after the server exits for a restart is to confirm in PR 18 (shawl has restart options).

Both installers open `http://localhost:7337` at the end where they can, which leads into the wizard.

**Releases.** `release.yml` runs on `v*` tags:

1. It builds the `.pkg` on a macOS runner and the setup `.exe` on a Windows runner.
2. Each runner runs an installer smoke test: install silently, wait for the service, check an unauthenticated request such as `GET /api/auth/me` answers, then uninstall.
3. It creates a **draft** release with both files and `SHA256SUMS.txt`, marked as a pre-release when the tag has a suffix such as `-alpha.1`.

The tag must match the version in `package.json`, which a small release PR bumps. The same installer jobs also run in `ci.yml` on PRs that change `packaging/` or the workflows.

---

## PR sequence

Each PR adds its own tests, and CI must be green before it merges. CC2 PRs also need Rob's hardware check. "Manual check" lists are run by the PR's author and repeated by Rob where they need his machines.

### Groundwork

1. **Plan.**
   - **Scope:** this document as `docs/phase-1.md`, linked from the README. Nothing else.
2. **Windows CI.**
   - **Scope:** a `windows-latest` job running `pnpm test` on every PR, and fixes for whatever fails: paths, line endings (`.gitattributes`), file locking in tests, and the default data folder from `env-paths` on Windows.
   - **Docs:** the README's prerequisites list Windows for running from source.

### Interface for the CC2

3. **Write-only settings and setup help.**
   - **Scope:** `writeOnly` fields in driver-sdk and the conformance kit (they must be strings), `secretsSet` in the API, keep-on-blank edits, log redaction, the password field and placeholder in the web form, `manifest.setupHelp` on the add form, and the OpenAPI spec and web types regenerated.
   - **Tests:** a secret never appears in any API response, event or log line; a blank edit keeps it; a new value replaces it.
4. **Filament slots and read-only heaters.**
   - **Scope:** the schemas, the `filament` driver message, `printer.filament_changed` (deduplicated, state category), the reducer, `PrinterState.filament`, `Heater.controllable`, a read-only "Filament" card on the printer page, and an event-log description. The simulator gains a "filament slots" setting (0 or 4), so all of it can be tried without hardware.
   - **Tests:** reducer, dedupe, persistence (stored every time, never pruned), round trips, the conformance kit, and the UI card.

### Elegoo Centauri Carbon 2

5. **CC2: connection and status.**
   - **Scope:** the `driver-elegoo-cc2` package, its settings and setup help, finding the serial by unicast UDP, MQTT connect / register / heartbeat / reconnect, full status plus deltas with gap detection, the status mapping, telemetry, job lifecycle and capabilities. **Read-only:** no commands yet. Also the fake CC2 and a registry entry.
   - **Tests:** conformance against the fake; status-mapping tables; delta merging and gap recovery; heartbeat timeout; "too many clients"; wrong access code; reconnect.
   - **Hardware check:**
     - Firmware reads v02.01.00.00.
     - Add the printer by address and access code; it shows idle.
     - Start a print from the printer's screen: preparing, then printing, with progress, layers and temperatures updating.
     - Pause and resume from the screen.
     - Reboot the printer: offline, then it reconnects.
     - With ElegooSlicer connected at the same time, both keep working.
     - A wrong access code gives a clear error.
     - Note the codes seen for each state, to settle the "to confirm" rows.
6. **CC2: commands and files.**
   - **Scope:** start (with per-printer defaults), pause, resume (resolving once the status confirms), cancel, home, move, temperatures, fans, the file list and the chunked upload.
   - **Tests:** every command against the fake, keep-alive upload (the fake answers 429 to a new connection per chunk), abort on a failed chunk, the MD5 header, and error 1009 as `invalid_state`.
   - **Hardware check:**
     - Upload a `.gcode` from ElegooSlicer; it's listed.
     - Start it from our UI: auto-levelling runs, then it prints.
     - Pause, resume (it takes a while, and the UI stays correct), cancel.
     - Set the nozzle and bed when idle; 400 °C is refused as unsafe.
     - Each fan.
     - Home, then jog each axis.
     - Confirm the fan scale and each command method on this firmware.
7. **CC2: camera and CANVAS.**
   - **Scope:** the on-demand snapshot (enable if needed, one frame, close, "camera busy"), and CANVAS trays as filament slots. Also the driver README crediting `elegoo-link` and the Home Assistant integration.
   - **Tests:** the snapshot frame parser, the one-slot fake (busy when held, released after a snapshot), and the CANVAS mapping.
   - **Hardware check:**
     - A snapshot renders.
     - While the Elegoo app or slicer shows the camera, a snapshot says "camera busy", and the app keeps its view afterwards.
     - The trays show the right material and colour.
     - Loading or unloading a tray produces one `printer.filament_changed`.
     - A multi-colour print starts with trays chosen by the printer.

### Discovery

8. **Discovery service and CC2 discovery.**
   - **Scope:** `DriverModule.discovery` and the found-printer schema, the `identity` message and a new `identity` column on printers (with a migration), `apps/server/src/discovery/` (UDP and the scan lifecycle), `POST /api/discovery`, the `discovery` WebSocket topic, marking already-added printers, and the CC2's broadcast method.
   - **Tests:** the fake CC2 answering on loopback, parse functions, one scan at a time, already-added matching, and the topic's snapshot-then-events.
   - **Hardware check:** a scan through the API finds your CC2, with its name, model and serial, and whether LAN Only is on.
9. **Web: Find printers.**
   - **Scope:**
     - a Find printers page (from the printers list) that scans and lists what it finds live
     - "Add" opens the add form pre-filled, asking only for the missing fields (the access code)
     - already-added printers are marked
     - a CC2 with LAN Only off shows how to switch it on
   - **Hardware check:** find and add the CC2 entering only the access code.
10. **Opt-in subnet scan.**
    - **Scope:** listing the server's own IPv4 subnets (each /24 or smaller), the `probe` method with a concurrency cap and short timeouts, the CC2's unicast probe, and a "Scan my network" button with its explanation.
    - **Tests:** subnet listing and limits, the probe scheduler, timeouts.
11. **Following address changes.**
    - **Scope:** the targeted search for printers that have been offline for a minute, updating the address and restarting the driver, `printer.address_changed` with its event-log text and a toast.
    - **Tests:** fake timers, a fake CC2 moving to a new loopback address, no search while online, and never a subnet scan.
    - **Hardware check:** give the CC2 a new address (e.g. change its DHCP reservation and reboot it); it reconnects by itself and the event log shows the change.

### Install

12. **Config file, restarts and service logging.**
    - **Scope:** layered config with `config.toml` (`smol-toml`), `OPS_SERVICE`, `GET`/`PATCH /api/settings`, live versus restart-required settings, restart by exiting in service mode, and rotating log files (`pino-roll`).
    - **Tests:** layering order, every validation message, atomic rewrite, live updates (e.g. retention), and the restart signal.
13. **Network access and host names.**
    - **Scope:** `network.access` (`local` binds 127.0.0.1; `lan` binds every interface), automatically accepting this computer's addresses and names, and refreshing addresses on an unknown Host.
    - **Tests:** Host check tables for both modes, and that DNS-rebinding names are still refused.
    - **Manual check:** with `lan`, open the UI from a phone by IP and by `<hostname>.local`.
14. **Web: Settings page and first-run wizard.**
    - **Scope:** the Settings page, the wizard steps after `/setup`, the `app_state` table (with a migration), skippable steps, and waiting through a restart.
    - **Tests:** wizard routing and resuming, the forms, and the restart wait (fake socket).
15. **Update check and About.**
    - **Scope:** the opt-in daily check (pre-release aware), the banner with per-version dismissal, and the About page with version, licence, notices and source link.
    - **Tests:** version comparison, never contacting GitHub when off (asserted with a fake fetch), and the banner.
16. **Release staging.**
    - **Scope:** `packaging/stage.ts` (the build without the simulator, the pinned Node download and checksum check, pruned production dependencies, licences and notices), and a test that the staged server starts with its bundled Node.
17. **macOS installer.**
    - **Scope:** `pkgbuild`/`productbuild` scripts, the LaunchDaemon plist, user creation, upgrade and uninstall scripts, a CI job that builds the `.pkg` and runs the install smoke test on PRs touching packaging, and the README's macOS install section.
    - **Manual check** on Rob's Mac:
      - "Open Anyway" install.
      - The service runs after a reboot, before logging in.
      - The wizard works end to end.
      - Discovery from the daemon finds the CC2. This confirms macOS's Local Network rule for a non-root daemon.
      - Upgrading over itself keeps the data.
      - `uninstall.sh` keeps the data; reinstalling picks it back up.
18. **Windows installer.**
    - **Scope:** the Inno Setup script, shawl, the service account and folder permissions, the firewall rules, upgrade and uninstall, a CI job that builds and smoke-tests the installer on PRs touching packaging, and the README's Windows install section.
    - **Manual check** on Rob's Windows PC:
      - SmartScreen "Run anyway".
      - The service runs after a reboot.
      - With network access on, a phone can open the UI.
      - Discovery finds the CC2 through the firewall.
      - Upgrading keeps the data; uninstalling keeps the data.
      - Note whether Smart App Control blocks anything unsigned.
19. **Release workflow.**
    - **Scope:** `release.yml` (tag → both installers → smoke tests → draft release with `SHA256SUMS.txt`), the version-matching check, and release steps in `CONTRIBUTING.md`.
    - **Afterwards:** Rob tags and publishes **v0.1.0-alpha.1** as a pre-release.

### Experimental drivers

20. **Interface for Bambu.**
    - **Scope:** `manifest.maturity` and its badge, `Capabilities.notices` with an optional action button (shown as banners on the printer page), and the `udp-listen` discovery method.
    - **Tests:** the schemas, the banner and action wiring through `extension.invoke`, and the listener against a fake announcer.
21. **Bambu: connection, status and monitor-only.**
    - **Scope:** the `driver-bambu` package, settings (address, serial, access code, per-printer print defaults), MQTT over TLS with first-connect pinning and the "trust new certificate" action, `pushall` plus deltas, status mapping and telemetry, model-based capabilities, Developer Mode detection with the monitor-only notice, AMS slots, HMS alerts, SSDP discovery, and the fake Bambu (MQTT over TLS part).
    - **Tests:** conformance, pinning (first, same, changed), monitor-only capabilities, delta merging, and SSDP parsing.
22. **Bambu: commands, files, print start and camera.**
    - **Scope:** control commands through `gcode_line` (Developer Mode only), FTPS list and upload, `project_file` with plate 1 and the defaults, P1/A1 JPEG snapshots, and the fake FTPS and camera servers.
    - **Tests:** every command, FTPS against the fake (implicit TLS, passive mode, session reuse), the print-start message, and the camera frame reader.
23. **Interface for HTTP drivers.**
    - **Scope:** the `mdns` discovery method (`bonjour-service`), HTTP `probe` methods in the subnet scan, and resolving devices that several drivers claim, by priority.
    - **Tests:** a fake mDNS responder, and claim resolution (Moonraker and the Prusa-Link Pi app versus OctoPrint).
24. **PrusaLink driver.**
    - **Scope:** the package, no-qop Digest auth, status polling and mapping, job control, upload and file list, capabilities without manual controls, discovery, and the fake PrusaLink.
    - **Tests:** conformance, the Digest handshake, polling with fake timers, and the 8.3 file names.
25. **Moonraker driver.**
    - **Scope:** the package, WebSocket JSON-RPC, subscribing and merging deltas, reading heaters, fans and the build volume, G-code controls, upload, webcam snapshots, the optional API key, the probe and mDNS, and the fake Moonraker.
    - **Tests:** conformance, Klippy state changes (startup, ready, shutdown), the key being required or not, and several instances on one host.
26. **Interface for OctoPrint: setup actions.**
    - **Scope:** `DriverModule.setupActions` (with Zod input and output schemas), `POST /api/driver-types/{type}/actions/{action}`, and add-form buttons that run them and fill in fields.
    - **Tests:** schema checks, unknown actions, and errors.
27. **OctoPrint driver.**
    - **Scope:** the package, REST and push socket, status and event mapping, controls, upload, snapshots, the Application Keys flow plus paste fallback, mDNS discovery, and the fake OctoPrint.
    - **Tests:** conformance, the Application Keys flow (approved, denied, timed out), `PrintFailed` with reason "cancelled" treated as a cancel, and avoiding endpoints removed in 2.0.
28. **Wrap-up.**
    - **Scope:** README Features and supported-printers table (with maturity), install instructions for both platforms, Project Structure updated, and the v0.1.0 release checklist.
    - **Afterwards:** Rob tags and publishes **v0.1.0**.

---

## Verification

**Automated.** `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:smoke` must pass on Linux, and `pnpm test` on macOS and Windows. The installer jobs must pass on PRs that change packaging, and on every release tag.

| Area                                    | Tests that prove it                                         |
| --------------------------------------- | ----------------------------------------------------------- |
| Each driver against its protocol        | Conformance kit and scenario tests against its fake printer |
| Secrets never leak                      | API, event and log tests                                    |
| Filament slots history                  | Reducer, dedupe and persistence tests                       |
| Discovery, subnet scan, address changes | Discovery service tests with fakes on loopback              |
| Config layering and restarts            | Config and settings API tests                               |
| Host names in LAN mode                  | Host check tables                                           |
| Installers install, run and uninstall   | Installer smoke tests on macOS and Windows runners          |

**Manual walkthrough** at the end of Phase 1, on Rob's Mac and Windows PC with the CC2:

1. Install from the draft release's installer, getting past Gatekeeper or SmartScreen.
2. The browser opens on the setup screen. Create the admin.
3. Wizard: choose "any device on my network". The server restarts and the wizard continues. Keep the default retention, leave the update check off, then find printers: the CC2 is listed and is added with only its access code.
4. From a phone, open the UI by the computer's IP.
5. Upload a `.gcode`, print it, watch status and progress, pause, resume and cancel.
6. The snapshot renders. The CANVAS trays show their filament.
7. Change the CC2's IP address: it's found again and reconnects by itself.
8. Reboot the computer: the service is running before anyone logs in, and the printer reconnects.
9. Run the installer again (upgrade): the data is kept.
10. Uninstall: the data folder is still there.
11. Check that experimental drivers show their badge, and each fake printer can be added from a source build.

---

## Risks and things to confirm

- **The CC2 protocol is undocumented.** Several commands are confirmed only by community projects, and a firmware update could change things. The hardware checks in PRs 5–7 and 11 are the safeguard, and each driver's README records the firmware it was checked on.
- **The CC2's limits.** About 4 MQTT clients and one camera viewer, shared with Elegoo's own apps.
- **macOS Local Network privacy.** Apple's TN3179 says daemons started by launchd are allowed automatically. Whether that holds for a non-root role account is confirmed in PR 17.
- **macOS 27 is current.** Some installer facts come from sources written for macOS 15 and 26, so PR 17 retests them.
- **Unsigned builds.** Users must get past Gatekeeper and SmartScreen. Windows Smart App Control may block unsigned files outright, with no per-app override. If PR 18 finds that it blocks the installer or shawl, signing becomes a priority.
- **Bambu's rules.** Only Developer Mode is used. Commands are never signed with Bambu's certificates, and Bambu's software is never impersonated. Behaviour differs by model and firmware (storage, camera, TLS 1.3 on P2S), and none of it can be checked on hardware here.
- **Node 26 becomes LTS on 2026-10-28.** The installers pin an exact Node version, which is updated deliberately.

---

## Sources

Checked on 2026-10-07.

- **Elegoo CC2:**
  - Elegoo's client library, `elegoo-link`: https://github.com/ELEGOO-3D/elegoo-link
  - Home Assistant integration protocol notes: https://github.com/danielcherubini/elegoo-homeassistant/blob/main/docs/CC2_PROTOCOL.md
  - LAN Only mode: https://wiki.elegoo.com/centauri-carbon-2-combo/how-to-connect-the-printer-using-elegoo-slicer-and-elegoo-matrix-app
- **Bambu Lab:**
  - Third-party integration: https://wiki.bambulab.com/en/software/third-party-integration
  - LAN mode: https://wiki.bambulab.com/en/knowledge-sharing/enable-lan-mode
  - Network ports: https://wiki.bambulab.com/en/general/printer-network-ports
  - OpenBambuAPI: https://github.com/Doridian/OpenBambuAPI
  - ha-bambulab: https://github.com/greghesp/ha-bambulab
  - Bambu's blog on cloud access and the community: https://blog.bambulab.com/setting-the-record-straight-on-cloud-access-and-community/
- **Moonraker:** https://moonraker.readthedocs.io/en/latest/
- **PrusaLink:**
  - API spec: https://github.com/prusa3d/Prusa-Link-Web/blob/master/spec/openapi.yaml
  - Firmware: https://github.com/prusa3d/Prusa-Firmware-Buddy
- **OctoPrint:**
  - API docs: https://docs.octoprint.org
  - Application Keys: https://github.com/OctoPrint/OctoPrint/blob/main/docs/bundledplugins/appkeys.rst
- **Node:**
  - Single executable applications: https://nodejs.org/docs/latest-v26.x/api/single-executable-applications.md
  - Release schedule: https://github.com/nodejs/Release/blob/main/schedule.json
- **macOS:**
  - TN3179, Local Network privacy: https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy
  - `launchd.plist(5)`: https://keith.github.io/xcode-man-pages/launchd.plist.5.html
  - `pkgbuild(1)`: https://keith.github.io/xcode-man-pages/pkgbuild.1.html
- **Windows:**
  - shawl: https://github.com/mtkennerly/shawl
  - Inno Setup: https://jrsoftware.org/isinfo.php
  - Firewall rules: https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules
