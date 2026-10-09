/**
 * The API's types, generated from apps/server/openapi.json by
 * openapi-typescript. Don't edit this file: run
 * `pnpm --filter @openprintstack/web generate`.
 */

import type { JsonValue } from "@openprintstack/protocol";
export interface paths {
    "/api/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Log in
         * @description Sets the ops_session cookie. After 5 failed logins from one address, each further failure makes it wait (1 s, doubling to 5 min), during which logins answer 429.
         */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Log out
         * @description Ends this session and clears the cookie. Answers 204 with or without a valid session.
         */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The logged-in user */
        get: operations["me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/setup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create the admin on first run, and log in
         * @description Only works while no user exists. Sets the ops_session cookie. Publishes auth.setup_completed.
         */
        post: operations["setup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/driver-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The driver types printers can be added with */
        get: operations["listDriverTypes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The event log, newest first */
        get: operations["listEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/printers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every printer's live snapshot */
        get: operations["listPrinters"];
        put?: never;
        /**
         * Add a printer
         * @description Settings left out take their defaults. Starts the driver and answers after its first connect attempt. Publishes printer.added.
         */
        post: operations["addPrinter"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/printers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A printer's live snapshot */
        get: operations["getPrinter"];
        put?: never;
        post?: never;
        /**
         * Delete a printer
         * @description Stops its driver and deletes its files on the server; allowed during a job. Its events are kept. Publishes printer.removed.
         */
        delete: operations["deletePrinter"];
        options?: never;
        head?: never;
        /**
         * Rename a printer and/or change its settings
         * @description A rename applies at once. Changed settings restart the driver, answering after its first connect attempt. Publishes printer.updated when anything changed.
         */
        patch: operations["updatePrinter"];
        trace?: never;
    };
    "/api/printers/{id}/cameras": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A printer's cameras */
        get: operations["listCameras"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/printers/{id}/cameras/{cameraId}/snapshot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A snapshot from a camera */
        get: operations["getSnapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/printers/{id}/commands": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run a command
         * @description Answers once the printer has done it, or refused. Publishes command.requested and command.result. One command at a time per printer: another gets 409 printer_busy straight away.
         */
        post: operations["runCommand"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/printers/{id}/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A printer's stored config, settings included */
        get: operations["getPrinterConfig"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/printers/{id}/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The files on a printer */
        get: operations["listFiles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/printers/{id}/files/{fileName}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Upload a file to a printer
         * @description The body is the file itself, with a Content-Length (chunked uploads get 411). The printer's file types, state and size limit are checked before the body is read. A file of the same name is replaced. Publishes command.requested and command.result for the file.upload command.
         */
        put: operations["uploadFile"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/printers/{id}/simulator/clear": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Clear the simulated printer's error and disconnect
         * @description Ends an error (failing a frozen job) and any simulated disconnect. Works while offline. No body, or null or {}.
         */
        post: operations["simulateClear"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/printers/{id}/simulator/faults/disconnect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Make the simulated printer unreachable for a while
         * @description It goes offline for durationS real seconds (1–3600), then reconnects by itself.
         */
        post: operations["simulateDisconnect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/printers/{id}/simulator/faults/error": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Put the simulated printer in error
         * @description A running job freezes until clear. The body is optional: null, {} or { message }.
         */
        post: operations["simulateError"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/printers/{id}/simulator/faults/filament-runout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run the simulated printer out of filament
         * @description Pauses a running print and raises a filament_runout alert. No body, or null or {}.
         */
        post: operations["simulateFilamentRunout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/printers/{id}/simulator/speed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Change the simulation speed
         * @description Until the driver restarts. The multiplier is 0.1–1000; the speedMultiplier setting is what survives a restart.
         */
        post: operations["simulateSpeed"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @enum {string} */
        AlertSeverity: "info" | "warning" | "error";
        ApiError: {
            error: {
                code: string;
                message: string;
                details?: components["schemas"]["JsonValue"];
            };
        };
        AuthLoginFailedEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: null;
            /** @constant */
            type: "auth.login_failed";
            /** @constant */
            category: "auth";
            payload: {
                username: string;
            };
        };
        AuthLoginSucceededEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: null;
            /** @constant */
            type: "auth.login_succeeded";
            /** @constant */
            category: "auth";
            payload: Record<string, never>;
        };
        AuthLogoutEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: null;
            /** @constant */
            type: "auth.logout";
            /** @constant */
            category: "auth";
            payload: Record<string, never>;
        };
        AuthSetupCompletedEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: null;
            /** @constant */
            type: "auth.setup_completed";
            /** @constant */
            category: "auth";
            payload: Record<string, never>;
        };
        /** @enum {string} */
        Axis: "x" | "y" | "z";
        BuildVolume: {
            x: {
                minMm: number;
                maxMm: number;
            };
            y: {
                minMm: number;
                maxMm: number;
            };
            z: {
                minMm: number;
                maxMm: number;
            };
        };
        Camera: {
            id: string;
            label: string;
        };
        CameraCapabilities: {
            snapshot: boolean;
            stream: boolean;
        };
        Capabilities: {
            commands: components["schemas"]["CommandKind"][];
            heaters: components["schemas"]["Heater"][];
            fans: components["schemas"]["Fan"][];
            axes: components["schemas"]["BuildVolume"] | null;
            maxMoveSpeedMmS: number | null;
            files: components["schemas"]["FileCapabilities"];
            cameras: components["schemas"]["CameraCapabilities"];
            extensions: string[];
        };
        /** @enum {string} */
        CommandKind: "print.start" | "print.pause" | "print.resume" | "print.cancel" | "motion.home" | "motion.move" | "temperature.set" | "fan.set" | "file.upload" | "extension.invoke";
        CommandRequestedEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: string;
            /** @constant */
            type: "command.requested";
            /** @constant */
            category: "command";
            payload: {
                commandId: string;
                command: components["schemas"]["PrinterCommand"];
            };
        };
        /** @description The command succeeded. A refused or failed command answers with an ApiError instead, whose details are { commandId, durationMs } once the command has been requested. */
        CommandResult: {
            commandId: string;
            /** @constant */
            ok: true;
            durationMs: number;
        };
        CommandResultEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: string;
            /** @constant */
            type: "command.result";
            /** @constant */
            category: "command";
            payload: {
                commandId: string;
                ok: boolean;
                error?: components["schemas"]["ErrorInfo"];
                durationMs: number;
            };
        };
        DriverType: {
            type: string;
            name: string;
            description: string;
            /** @description Short plain-text steps to follow before adding a printer of this type, shown above the add form. Empty when there are none. */
            setupHelp: string[];
            /** @description The settings' JSON Schema (draft 2020-12), describing the input: fields with a default are optional and carry it. Secrets are marked writeOnly. */
            settingsSchema: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** @description The default of each settings field that has one. */
            defaults: {
                [key: string]: components["schemas"]["JsonValue"];
            };
        };
        ErrorInfo: {
            code: string;
            message: string;
        };
        /** @enum {string} */
        EventCategory: "telemetry" | "state" | "command" | "config" | "auth" | "system";
        EventPage: {
            /** @description Newest first. */
            events: components["schemas"]["OpsEvent"][];
            /** @description The `before` for the next, older page; null when there's nothing older. */
            nextCursor: number | null;
            /** @description The username of each user these events name, by id. A deleted user isn't here. */
            users: {
                [key: string]: string;
            };
        };
        EventSource: {
            /** @constant */
            kind: "driver";
        } | {
            /** @constant */
            kind: "user";
            userId: string;
        } | {
            /** @constant */
            kind: "system";
        };
        /** @enum {string} */
        EventType: "printer.telemetry" | "printer.status_changed" | "printer.capabilities_changed" | "printer.alert" | "printer.job_started" | "printer.job_ended" | "printer.files_changed" | "printer.filament_changed" | "command.requested" | "command.result" | "printer.added" | "printer.updated" | "printer.removed" | "auth.setup_completed" | "auth.login_succeeded" | "auth.login_failed" | "auth.logout" | "system.started" | "system.stopping";
        ExtensionInvokeCommand: {
            /** @constant */
            kind: "extension.invoke";
            extension: string;
            action: string;
            params: components["schemas"]["JsonValue"];
        };
        Fan: {
            id: string;
            kind: components["schemas"]["FanKind"];
            label: string;
            controllable: boolean;
        };
        /** @enum {string} */
        FanKind: "part" | "auxiliary" | "chamber" | "other";
        FanReading: {
            percent: number | null;
        };
        FanSetCommand: {
            /** @constant */
            kind: "fan.set";
            fanId: string;
            percent: number;
        };
        Filament: {
            units: components["schemas"]["FilamentUnit"][];
        };
        FilamentSlot: {
            id: string;
            label: string;
            status: components["schemas"]["FilamentSlotStatus"];
            material: string | null;
            name: string | null;
            colorHex: string | null;
            nozzleMinC: number | null;
            nozzleMaxC: number | null;
        };
        /** @enum {string} */
        FilamentSlotStatus: "empty" | "loaded" | "active";
        FilamentUnit: {
            id: string;
            kind: components["schemas"]["FilamentUnitKind"];
            label: string;
            slots: components["schemas"]["FilamentSlot"][];
        };
        /** @enum {string} */
        FilamentUnitKind: "changer" | "external" | "other";
        FileCapabilities: {
            list: boolean;
            upload: boolean;
            acceptedExtensions: string[];
            maxUploadBytes: number | null;
        };
        FileUploadCommand: {
            /** @constant */
            kind: "file.upload";
            stagedFileId: string;
            fileName: string;
            sizeBytes: number;
        };
        Heater: {
            id: string;
            kind: components["schemas"]["HeaterKind"];
            label: string;
            /** @constant */
            controllable: true;
            maxC: number;
        } | {
            id: string;
            kind: components["schemas"]["HeaterKind"];
            label: string;
            /** @constant */
            controllable: false;
            maxC: null;
        };
        /** @enum {string} */
        HeaterKind: "nozzle" | "bed" | "chamber";
        /** @enum {string} */
        JobOutcome: "completed" | "cancelled" | "failed";
        JobProgress: {
            fileName: string;
            progressPercent: number | null;
            elapsedS: number | null;
            remainingS: number | null;
            currentLayer: number | null;
            totalLayers: number | null;
        };
        JsonValue: JsonValue;
        LoginRequest: {
            username: string;
            password: string;
        };
        MotionHomeCommand: {
            /** @constant */
            kind: "motion.home";
            axes: components["schemas"]["Axis"][];
        };
        MotionMoveCommand: {
            /** @constant */
            kind: "motion.move";
            x?: number;
            y?: number;
            z?: number;
            speedMmS?: number;
        };
        NewPrinterRequest: {
            /** @description 1–64 characters after trimming, with no control characters. Unique, ignoring the case of A–Z. */
            name: string;
            driverType: string;
            /** @description Settings fields, checked against the driver type's settings schema. An empty string for a write-only field counts as left out. */
            settings?: {
                [key: string]: components["schemas"]["JsonValue"];
            };
        };
        OpsEvent: components["schemas"]["PrinterTelemetryEvent"] | components["schemas"]["PrinterStatusChangedEvent"] | components["schemas"]["PrinterCapabilitiesChangedEvent"] | components["schemas"]["PrinterAlertEvent"] | components["schemas"]["PrinterJobStartedEvent"] | components["schemas"]["PrinterJobEndedEvent"] | components["schemas"]["PrinterFilesChangedEvent"] | components["schemas"]["PrinterFilamentChangedEvent"] | components["schemas"]["CommandRequestedEvent"] | components["schemas"]["CommandResultEvent"] | components["schemas"]["PrinterAddedEvent"] | components["schemas"]["PrinterUpdatedEvent"] | components["schemas"]["PrinterRemovedEvent"] | components["schemas"]["AuthSetupCompletedEvent"] | components["schemas"]["AuthLoginSucceededEvent"] | components["schemas"]["AuthLoginFailedEvent"] | components["schemas"]["AuthLogoutEvent"] | components["schemas"]["SystemStartedEvent"] | components["schemas"]["SystemStoppingEvent"];
        Position: {
            x: number;
            y: number;
            z: number;
        };
        PrintCancelCommand: {
            /** @constant */
            kind: "print.cancel";
        };
        PrintPauseCommand: {
            /** @constant */
            kind: "print.pause";
        };
        PrintResumeCommand: {
            /** @constant */
            kind: "print.resume";
        };
        PrintStartCommand: {
            /** @constant */
            kind: "print.start";
            fileName: string;
        };
        PrinterAddedEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: string;
            /** @constant */
            type: "printer.added";
            /** @constant */
            category: "config";
            payload: {
                name: string;
                driverType: string;
            };
        };
        PrinterAlertEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: string;
            /** @constant */
            type: "printer.alert";
            /** @constant */
            category: "state";
            payload: {
                severity: components["schemas"]["AlertSeverity"];
                code: string;
                message: string;
            };
        };
        PrinterCapabilitiesChangedEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: string;
            /** @constant */
            type: "printer.capabilities_changed";
            /** @constant */
            category: "state";
            payload: {
                capabilities: components["schemas"]["Capabilities"];
            };
        };
        PrinterCommand: components["schemas"]["PrintStartCommand"] | components["schemas"]["PrintPauseCommand"] | components["schemas"]["PrintResumeCommand"] | components["schemas"]["PrintCancelCommand"] | components["schemas"]["MotionHomeCommand"] | components["schemas"]["MotionMoveCommand"] | components["schemas"]["TemperatureSetCommand"] | components["schemas"]["FanSetCommand"] | components["schemas"]["FileUploadCommand"] | components["schemas"]["ExtensionInvokeCommand"];
        /** @description A printer's stored config. Settings are stored with every default filled in; write-only ones are never returned. */
        PrinterConfig: {
            id: string;
            name: string;
            driverType: string;
            /** @description Every stored setting except the write-only ones, which are never returned. Empty if the driver type isn't available. */
            settings: {
                [key: string]: string | number | boolean;
            };
            /** @description The write-only settings that have a stored value. */
            secretsSet: string[];
            settingsVersion: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        PrinterFilamentChangedEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: string;
            /** @constant */
            type: "printer.filament_changed";
            /** @constant */
            category: "state";
            payload: {
                filament: components["schemas"]["Filament"] | null;
            };
        };
        PrinterFile: {
            name: string;
            sizeBytes: number | null;
            modifiedAt: string | null;
        };
        PrinterFilesChangedEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: string;
            /** @constant */
            type: "printer.files_changed";
            /** @constant */
            category: "state";
            payload: Record<string, never>;
        };
        PrinterInfo: {
            id: string;
            name: string;
            driverType: string;
        };
        PrinterJobEndedEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: string;
            /** @constant */
            type: "printer.job_ended";
            /** @constant */
            category: "state";
            payload: {
                outcome: components["schemas"]["JobOutcome"];
                fileName: string;
            };
        };
        PrinterJobStartedEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: string;
            /** @constant */
            type: "printer.job_started";
            /** @constant */
            category: "state";
            payload: {
                fileName: string;
            };
        };
        PrinterRemovedEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: string;
            /** @constant */
            type: "printer.removed";
            /** @constant */
            category: "config";
            payload: {
                name: string;
            };
        };
        PrinterSnapshot: {
            printer: components["schemas"]["PrinterInfo"];
            state: components["schemas"]["PrinterState"];
            seq: number;
        };
        PrinterState: {
            status: components["schemas"]["PrinterStatus"];
            statusDetail: string | null;
            error: components["schemas"]["ErrorInfo"] | null;
            telemetry: components["schemas"]["Telemetry"];
            capabilities: components["schemas"]["Capabilities"] | null;
            filament: components["schemas"]["Filament"] | null;
            /** Format: date-time */
            updatedAt: string;
        };
        /** @enum {string} */
        PrinterStatus: "connecting" | "offline" | "idle" | "busy" | "preparing" | "printing" | "pausing" | "paused" | "cancelling" | "error";
        PrinterStatusChangedEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: string;
            /** @constant */
            type: "printer.status_changed";
            /** @constant */
            category: "state";
            payload: {
                previous: components["schemas"]["PrinterStatus"] | null;
                status: components["schemas"]["PrinterStatus"];
                detail: string | null;
                error: components["schemas"]["ErrorInfo"] | null;
            };
        };
        PrinterTelemetryEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: string;
            /** @constant */
            type: "printer.telemetry";
            /** @constant */
            category: "telemetry";
            payload: {
                telemetry: components["schemas"]["Telemetry"];
            };
        };
        PrinterUpdateRequest: {
            /** @description 1–64 characters after trimming, with no control characters. Unique, ignoring the case of A–Z. */
            name?: string;
            /** @description Fields to change; the rest keep their stored values. A write-only field left out or empty keeps its stored value, and a new value replaces it. Changing settings restarts the driver, and is refused (409 job_active) while a job is active. */
            settings?: {
                [key: string]: components["schemas"]["JsonValue"];
            };
        };
        PrinterUpdatedEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: string;
            /** @constant */
            type: "printer.updated";
            /** @constant */
            category: "config";
            payload: {
                changedFields: ("name" | "settings")[];
            };
        };
        SessionUser: {
            id: string;
            username: string;
        };
        SetupRequest: {
            /** @description 1–32 ASCII letters, digits, dots, underscores or hyphens, after trimming. Matched ignoring case. */
            username: string;
            /** @description 12–1024 characters (Unicode code points), counted after NFKC normalisation. Spaces count and nothing is trimmed. */
            password: string;
        };
        SimulatorDisconnectParams: {
            durationS: number;
        };
        SimulatorErrorParams: null | {
            message?: string;
        };
        SimulatorSpeedParams: {
            multiplier: number;
        };
        SystemStartedEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: null;
            /** @constant */
            type: "system.started";
            /** @constant */
            category: "system";
            payload: {
                version: string;
            };
        };
        SystemStoppingEvent: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            ts: string;
            seq: number;
            bootId: string;
            correlationId: string | null;
            source: components["schemas"]["EventSource"];
            printerId: null;
            /** @constant */
            type: "system.stopping";
            /** @constant */
            category: "system";
            payload: Record<string, never>;
        };
        Telemetry: {
            temperatures: {
                [key: string]: components["schemas"]["TemperatureReading"];
            };
            fans: {
                [key: string]: components["schemas"]["FanReading"];
            };
            speedPercent: number | null;
            position: components["schemas"]["Position"] | null;
            homedAxes: components["schemas"]["Axis"][] | null;
            job: components["schemas"]["JobProgress"] | null;
        };
        TemperatureReading: {
            actualC: number | null;
            targetC: number | null;
        };
        TemperatureSetCommand: {
            /** @constant */
            kind: "temperature.set";
            heaterId: string;
            targetC: number;
        };
        /** @description Any command except file.upload, which only uploads create. */
        UserCommand: components["schemas"]["PrintStartCommand"] | components["schemas"]["PrintPauseCommand"] | components["schemas"]["PrintResumeCommand"] | components["schemas"]["PrintCancelCommand"] | components["schemas"]["MotionHomeCommand"] | components["schemas"]["MotionMoveCommand"] | components["schemas"]["TemperatureSetCommand"] | components["schemas"]["FanSetCommand"] | components["schemas"]["ExtensionInvokeCommand"];
        UserResponse: {
            user: components["schemas"]["SessionUser"];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Logged in. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponse"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description payload_too_large (over 64 KiB of JSON) or file_too_large. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description unsupported_media_type: the body must be JSON. */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description too_many_attempts: too many failed logins. Retry-After says how many seconds to wait. */
            429: {
                headers: {
                    /** @description How many seconds to wait before trying again. */
                    "Retry-After"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Logged out. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The logged-in user. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponse"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    setup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetupRequest"];
            };
        };
        responses: {
            /** @description The admin, now logged in. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponse"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description payload_too_large (over 64 KiB of JSON) or file_too_large. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description unsupported_media_type: the body must be JSON. */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listDriverTypes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Each driver type, with its settings form. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        driverTypes: components["schemas"]["DriverType"][];
                    };
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listEvents: {
        parameters: {
            query?: {
                /** @description Only this printer's events. */
                printerId?: string;
                /** @description Only these types. Repeat it for several. */
                type?: components["schemas"]["EventType"] | components["schemas"]["EventType"][];
                /** @description Only these categories. Repeat it for several. */
                category?: components["schemas"]["EventCategory"] | components["schemas"]["EventCategory"][];
                /** @description Telemetry is left out unless this is true, or type or category names it. */
                includeTelemetry?: "true" | "false";
                /** @description The previous page's nextCursor. */
                before?: number;
                /** @description At most this many events (default 100). */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of events. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventPage"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listPrinters: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every printer, by name. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        printers: components["schemas"]["PrinterSnapshot"][];
                    };
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    addPrinter: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewPrinterRequest"];
            };
        };
        responses: {
            /** @description The new printer. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterConfig"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description payload_too_large (over 64 KiB of JSON) or file_too_large. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description unsupported_media_type: the body must be JSON. */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The printer can't or won't do it: unsupported, unsafe, printer_rejected, unknown_driver_type or invalid_settings. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getPrinter: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The printer. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterSnapshot"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    deletePrinter: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    updatePrinter: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PrinterUpdateRequest"];
            };
        };
        responses: {
            /** @description The printer's config. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterConfig"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description payload_too_large (over 64 KiB of JSON) or file_too_large. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description unsupported_media_type: the body must be JSON. */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The printer can't or won't do it: unsupported, unsafe, printer_rejected, unknown_driver_type or invalid_settings. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listCameras: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The printer's cameras. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        cameras: components["schemas"]["Camera"][];
                    };
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The printer can't or won't do it: unsupported, unsafe, printer_rejected, unknown_driver_type or invalid_settings. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description timeout: the printer didn't answer in time. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getSnapshot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
                /** @description The camera's id. */
                cameraId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The image, with the Content-Type the driver gave. Never cached. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/*": Blob;
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The printer can't or won't do it: unsupported, unsafe, printer_rejected, unknown_driver_type or invalid_settings. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description timeout: the printer didn't answer in time. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    runCommand: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserCommand"];
            };
        };
        responses: {
            /** @description The command succeeded. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommandResult"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description payload_too_large (over 64 KiB of JSON) or file_too_large. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description unsupported_media_type: the body must be JSON. */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The printer can't or won't do it: unsupported, unsafe, printer_rejected, unknown_driver_type or invalid_settings. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description timeout: the printer didn't answer in time. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getPrinterConfig: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The printer's config. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterConfig"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listFiles: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The printer's files, as its driver lists them. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        files: components["schemas"]["PrinterFile"][];
                    };
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The printer can't or won't do it: unsupported, unsafe, printer_rejected, unknown_driver_type or invalid_settings. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description timeout: the printer didn't answer in time. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    uploadFile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
                /** @description The file's name on the printer: 1–255 bytes in UTF-8, with no /, \ or control characters, and not . or ... Percent-encode it in the path. */
                fileName: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": Blob;
            };
        };
        responses: {
            /** @description The printer has the file. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommandResult"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description length_required: the upload has no Content-Length. */
            411: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description payload_too_large (over 64 KiB of JSON) or file_too_large. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The printer can't or won't do it: unsupported, unsafe, printer_rejected, unknown_driver_type or invalid_settings. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description timeout: the printer didn't answer in time. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    simulateClear: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": null | Record<string, never>;
            };
        };
        responses: {
            /** @description The simulator did it. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommandResult"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description payload_too_large (over 64 KiB of JSON) or file_too_large. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description unsupported_media_type: the body must be JSON. */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The printer can't or won't do it: unsupported, unsafe, printer_rejected, unknown_driver_type or invalid_settings. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description timeout: the printer didn't answer in time. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    simulateDisconnect: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SimulatorDisconnectParams"];
            };
        };
        responses: {
            /** @description The simulator did it. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommandResult"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description payload_too_large (over 64 KiB of JSON) or file_too_large. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description unsupported_media_type: the body must be JSON. */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The printer can't or won't do it: unsupported, unsafe, printer_rejected, unknown_driver_type or invalid_settings. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description timeout: the printer didn't answer in time. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    simulateError: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["SimulatorErrorParams"];
            };
        };
        responses: {
            /** @description The simulator did it. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommandResult"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description payload_too_large (over 64 KiB of JSON) or file_too_large. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description unsupported_media_type: the body must be JSON. */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The printer can't or won't do it: unsupported, unsafe, printer_rejected, unknown_driver_type or invalid_settings. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description timeout: the printer didn't answer in time. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    simulateFilamentRunout: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": null | Record<string, never>;
            };
        };
        responses: {
            /** @description The simulator did it. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommandResult"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description payload_too_large (over 64 KiB of JSON) or file_too_large. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description unsupported_media_type: the body must be JSON. */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The printer can't or won't do it: unsupported, unsafe, printer_rejected, unknown_driver_type or invalid_settings. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description timeout: the printer didn't answer in time. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    simulateSpeed: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The printer's id. */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SimulatorSpeedParams"];
            };
        };
        responses: {
            /** @description The simulator did it. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommandResult"];
                };
            };
            /** @description The request isn't valid: validation_failed, invalid_json or upload_incomplete. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not logged in: unauthenticated, or setup_required while no user exists. On login, invalid_credentials. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Host or Origin header isn't allowed: host_not_allowed or origin_not_allowed. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Not found: not_found, printer_not_found or file_not_found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description It conflicts with the current state, e.g. printer_busy, printer_offline, invalid_state, name_taken, job_active or setup_done. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description payload_too_large (over 64 KiB of JSON) or file_too_large. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description unsupported_media_type: the body must be JSON. */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The printer can't or won't do it: unsupported, unsafe, printer_rejected, unknown_driver_type or invalid_settings. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description internal: the server or the driver failed. */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description timeout: the printer didn't answer in time. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
}
