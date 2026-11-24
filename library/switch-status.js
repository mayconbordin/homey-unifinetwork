'use strict';

/**
 * Maps a UniFi switch object (classic `stat/device` entry or a `device:sync`
 * WebSocket payload — both share the same layout) to Homey capability values.
 *
 * Values the switch does not report are left out, so a model without a fan or
 * PoE never gets those capabilities.
 */

function toNumber(value) {
    const n = typeof value === 'number' ? value : Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
}

function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

/** Bytes per second → megabits per second. */
function toMbps(bytesPerSecond) {
    const n = toNumber(bytesPerSecond);
    return n === null ? null : round((n * 8) / 1e6, 2);
}

function findUplinkPort(device, ports) {
    const uplinkIdx = device.uplink && device.uplink.port_idx;
    return ports.find(p => uplinkIdx && p.port_idx === uplinkIdx)
        || ports.find(p => p.is_uplink === true)
        || null;
}

function parseSwitchStatus(device) {
    const caps = {};
    const set = (cap, value) => {
        if (value !== null && typeof value !== 'undefined') caps[cap] = value;
    };

    const portTable = Array.isArray(device.port_table) ? device.port_table : [];

    if (typeof device.state === 'number') set('connected', device.state === 1);
    if (device.ip) set('ipAddress', device.ip);
    if (portTable.length) set('ports', portTable.length);
    set('uptime', toNumber(device.uptime));
    set('measure_connected_clients', toNumber(device.num_sta));

    if (device.has_temperature !== false) set('measure_device_temperature', toNumber(device.general_temperature));
    if (typeof device.overheating === 'boolean') set('alarm_overheating', device.overheating);
    if (device.has_fan !== false) set('measure_fan_level', toNumber(device.fan_level));

    const systemStats = device['system-stats'] || {};
    set('measure_cpu_usage', toNumber(systemStats.cpu));
    set('measure_memory_usage', toNumber(systemStats.mem));

    const poeBudget = toNumber(device.total_max_power);
    if (poeBudget) {
        set('measure_poe_budget', poeBudget);
        const used = toNumber(device.total_used_power);
        if (used !== null) set('measure_poe_power', round(used, 1));
    }

    const uplinkPort = findUplinkPort(device, portTable);
    if (uplinkPort) {
        set('measure_uplink_rx', toMbps(uplinkPort['rx_bytes-r']));
        set('measure_uplink_tx', toMbps(uplinkPort['tx_bytes-r']));
    }

    const ports = portTable
        .filter(p => Number.isInteger(p.port_idx))
        .map(p => {
            const lastConnection = p.last_connection || {};
            const poePower = toNumber(p.poe_power);
            return {
                idx: p.port_idx,
                name: p.name || `Port ${p.port_idx}`,
                up: p.up === true,
                speed: p.up === true ? (toNumber(p.speed) || 0) : 0,
                poeCapable: p.port_poe === true,
                poeEnabled: p.poe_enable === true,
                poePower: poePower === null ? 0 : round(poePower, 2),
                connectedMac: lastConnection.mac || '',
                connectedIp: lastConnection.ip || '',
            };
        });

    return {caps, ports};
}

/**
 * Firmware status from a classic `stat/device` entry. Only read this from
 * REST data: `device:sync` messages are not guaranteed to carry the upgrade fields.
 */
function parseFirmware(device) {
    return {
        version: device.displayable_version || device.version || '',
        updateAvailable: device.upgradable === true && !!device.upgrade_to_firmware,
        latestVersion: device.upgrade_to_firmware || '',
    };
}

module.exports = {parseSwitchStatus, parseFirmware, toMbps, toNumber};
