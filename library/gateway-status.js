'use strict';

const {parseSwitchStatus, toNumber} = require('./switch-status');

function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

/** The active WAN's entry in objects keyed by WAN name ("WAN", "WAN2", ...). */
function activeWanEntry(map, wanName) {
    if (!map || typeof map !== 'object') return null;
    return map[wanName] || Object.values(map)[0] || null;
}

/**
 * Maps a UniFi gateway object (classic `stat/device` entry or a `device:sync`
 * payload, type udm / ugw / uxg) to Homey capability values.
 *
 * Builds on the switch parser for ports, clients, CPU, memory and uplink
 * traffic (the uplink port is the active WAN, so that is internet traffic),
 * then adds the WAN sensors. Values the gateway does not report are left out.
 */
function parseGatewayStatus(device) {
    const {caps, ports} = parseSwitchStatus(device);
    const set = (cap, value) => {
        if (value !== null && typeof value !== 'undefined') caps[cap] = value;
    };

    // The gateway's `ip` is its WAN address; show the LAN address instead
    if (device.lan_ip) caps.ipAddress = device.lan_ip;

    // PoE on a gateway is limited to a port or two; not worth a sensor
    delete caps.measure_poe_budget;
    delete caps.measure_poe_power;

    // Gateways report has_temperature: false but still list sensor readings
    if (!('measure_device_temperature' in caps) && Array.isArray(device.temperatures)) {
        const sensor = device.temperatures.find(t => t.type === 'cpu') || device.temperatures[0];
        const value = sensor && toNumber(sensor.value);
        if (value !== null && typeof value !== 'undefined') set('measure_device_temperature', round(value, 1));
    }

    const uplink = device.uplink || {};
    const wanName = uplink.comment || 'WAN';

    const wanStatus = device.last_wan_status;
    if (wanStatus && typeof wanStatus === 'object' && Object.keys(wanStatus).length) {
        set('alarm_wan_down', !Object.values(wanStatus).includes('online'));
    } else if (typeof uplink.up === 'boolean') {
        set('alarm_wan_down', !uplink.up);
    }

    set('wan_ip', uplink.ip || device.last_wan_ip);
    const geo = activeWanEntry(device.active_geo_info, wanName);
    if (geo && geo.address) set('public_ip', geo.address);

    const activeWan = ['wan1', 'wan2', 'wan3'].map(k => device[k]).find(w => w && w.is_uplink === true);
    const uptimeStats = activeWanEntry(device.uptime_stats, wanName);
    const latency = toNumber(activeWan && activeWan.latency) ?? toNumber(uptimeStats && uptimeStats.latency_average);
    set('measure_wan_latency', latency);
    const availability = toNumber(uptimeStats && uptimeStats.availability);
    if (availability !== null) set('measure_wan_availability', round(availability, 2));

    const speedtest = device['speedtest-status'];
    if (speedtest && toNumber(speedtest.rundate) > 0) {
        set('measure_speedtest_download', toNumber(speedtest.xput_download));
        set('measure_speedtest_upload', toNumber(speedtest.xput_upload));
    }

    // Mark WAN ports so they are easy to pick out ("Port 5 (WAN)")
    const portTable = Array.isArray(device.port_table) ? device.port_table : [];
    for (const port of ports) {
        const raw = portTable.find(p => p.port_idx === port.idx);
        const network = raw && typeof raw.network_name === 'string' ? raw.network_name.toLowerCase() : '';
        if (network.startsWith('wan')) {
            port.name = `${port.name} (${network.toUpperCase()})`;
        }
    }

    return {caps, ports};
}

module.exports = {parseGatewayStatus};
