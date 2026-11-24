'use strict';

const {parseSwitchStatus, parseFirmware, toMbps} = require('../../library/switch-status');

// Trimmed from a USW Pro XG 8 PoE stat/device entry (Network 11.0.99)
function xg8poe(overrides = {}) {
    const port = (idx, extra) => ({
        port_idx: idx, name: `Port ${idx}`, up: true, port_poe: true, poe_enable: true,
        'rx_bytes-r': 0, 'tx_bytes-r': 0, ...extra,
    });
    return {
        mac: '8c:30:66:a2:1b:ff',
        type: 'usw',
        state: 1,
        ip: '192.168.1.36',
        uptime: 3779963,
        num_sta: 2,
        has_temperature: true,
        general_temperature: 74,
        overheating: false,
        has_fan: true,
        fan_level: 49,
        'system-stats': {cpu: '6.9', mem: '15.4', uptime: '3779908'},
        total_max_power: 150,
        total_used_power: 56.89,
        uplink: {port_idx: 9, uplink_mac: 'a8:9c:6c:82:cd:88', uplink_remote_port: 6},
        port_table: [
            port(1, {poe_power: '15.64'}),
            port(5, {up: false, poe_enable: false}),
            {port_idx: 9, name: 'SFP+ 1', up: true, port_poe: false, is_uplink: true, 'rx_bytes-r': 1000000, 'tx_bytes-r': 125000},
            {port_idx: 10, name: 'SFP+ 2', up: true, port_poe: false},
        ],
        ...overrides,
    };
}

describe('parseSwitchStatus', () => {
    test('maps device-level sensors', () => {
        const {caps} = parseSwitchStatus(xg8poe());
        expect(caps).toEqual({
            connected: true,
            ipAddress: '192.168.1.36',
            ports: 4,
            uptime: 3779963,
            measure_connected_clients: 2,
            measure_device_temperature: 74,
            alarm_overheating: false,
            measure_fan_level: 49,
            measure_cpu_usage: 6.9,
            measure_memory_usage: 15.4,
            measure_poe_budget: 150,
            measure_poe_power: 56.9,
            measure_uplink_rx: 8,
            measure_uplink_tx: 1,
        });
    });

    test('maps ports using port_idx and UniFi names', () => {
        const {ports} = parseSwitchStatus(xg8poe());
        expect(ports.map(({idx, name, up, poeCapable, poeEnabled}) => ({idx, name, up, poeCapable, poeEnabled}))).toEqual([
            {idx: 1, name: 'Port 1', up: true, poeCapable: true, poeEnabled: true},
            {idx: 5, name: 'Port 5', up: false, poeCapable: true, poeEnabled: false},
            {idx: 9, name: 'SFP+ 1', up: true, poeCapable: false, poeEnabled: false},
            {idx: 10, name: 'SFP+ 2', up: true, poeCapable: false, poeEnabled: false},
        ]);
    });

    test('includes port speed, PoE power and the last connected device', () => {
        const {ports} = parseSwitchStatus(xg8poe({
            port_table: [
                {port_idx: 1, up: true, speed: 1000, poe_power: '15.64', last_connection: {mac: 'aa:bb', ip: '192.168.1.25'}},
                {port_idx: 2, up: false, speed: 10000, poe_power: '0.00'},
            ],
        }));
        expect(ports[0]).toMatchObject({speed: 1000, poePower: 15.64, connectedMac: 'aa:bb', connectedIp: '192.168.1.25'});
        // A down port reports speed 0 even if UniFi still has the last negotiated speed
        expect(ports[1]).toMatchObject({speed: 0, poePower: 0, connectedMac: '', connectedIp: ''});
    });

    test('omits sensors the switch does not have', () => {
        const {caps} = parseSwitchStatus(xg8poe({
            has_fan: false, fan_level: undefined,
            has_temperature: false, general_temperature: undefined, overheating: undefined,
            total_max_power: undefined, total_used_power: undefined,
        }));
        for (const cap of ['measure_fan_level', 'measure_device_temperature', 'alarm_overheating', 'measure_poe_budget', 'measure_poe_power']) {
            expect(caps).not.toHaveProperty(cap);
        }
    });

    test('reports disconnected when state is not 1', () => {
        expect(parseSwitchStatus(xg8poe({state: 0})).caps.connected).toBe(false);
    });

    test('falls back to is_uplink when uplink.port_idx is missing', () => {
        const {caps} = parseSwitchStatus(xg8poe({uplink: undefined}));
        expect(caps.measure_uplink_rx).toBe(8);
    });

    test('handles a payload without port_table', () => {
        const {caps, ports} = parseSwitchStatus({mac: 'x', state: 1});
        expect(ports).toEqual([]);
        expect(caps).toEqual({connected: true});
    });
});

describe('toMbps', () => {
    test('converts bytes/s to Mbit/s', () => {
        expect(toMbps(1250000)).toBe(10);
        expect(toMbps('125000')).toBe(1);
        expect(toMbps(undefined)).toBeNull();
    });
});

describe('parseFirmware', () => {
    test('reports an available update', () => {
        expect(parseFirmware({displayable_version: '7.5.15', upgradable: true, upgrade_to_firmware: '7.6.11.17272'}))
            .toEqual({version: '7.5.15', updateAvailable: true, latestVersion: '7.6.11.17272'});
    });

    test('no update when upgradable is false or the target is missing', () => {
        expect(parseFirmware({version: '7.6.11', upgradable: false}).updateAvailable).toBe(false);
        expect(parseFirmware({version: '7.6.11', upgradable: true}).updateAvailable).toBe(false);
    });
});
