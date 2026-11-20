'use strict';

/**
 * Rate-limits UniFi `device:sync` WebSocket messages per device.
 *
 * The controller pushes a full device object for every switch / AP / gateway
 * roughly once per second. Processing all of them is wasteful on Homey, so a
 * device is processed at most once per `minIntervalMs` — unless something a user
 * would notice changed (online state, client count, port link or PoE state), in
 * which case it is processed immediately.
 */
class DeviceSyncThrottle {
    constructor({minIntervalMs = 10000, now = () => Date.now()} = {}) {
        this._minIntervalMs = minIntervalMs;
        this._now = now;
        this._state = new Map();
    }

    static signature(payload) {
        const ports = Array.isArray(payload.port_table)
            ? payload.port_table.map(p => `${p.up ? 1 : 0}${p.poe_enable ? 1 : 0}`).join('')
            : '';
        return `${payload.state}|${payload.num_sta}|${payload.ip}|${ports}`;
    }

    /** Returns true if this payload should be processed now. */
    shouldProcess(payload) {
        if (!payload || !payload.mac) return false;
        const sig = DeviceSyncThrottle.signature(payload);
        const now = this._now();
        const prev = this._state.get(payload.mac);
        if (prev && prev.sig === sig && now - prev.ts < this._minIntervalMs) {
            return false;
        }
        this._state.set(payload.mac, {sig, ts: now});
        return true;
    }

    clear() {
        this._state.clear();
    }
}

module.exports = DeviceSyncThrottle;
