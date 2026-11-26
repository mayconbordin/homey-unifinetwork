'use strict';

const {parseGatewayStatus} = require('../../library/gateway-status');

const port = (idx, name, extra = {}) => ({
    port_idx: idx, name, up: false, speed: 10, port_poe: false, poe_enable: false, poe_power: '0.00', network_name: 'lan', ...extra,
});

// Trimmed from a Cloud Gateway Fiber (UCG Fiber) stat/device entry (Network 11.0.99)
function ucgFiber(overrides = {}) {
    return {
        mac: 'a8:9c:6c:82:cd:88',
        type: 'udm',
        state: 1,
        ip: '192.168.0.64',
        lan_ip: '192.168.1.1',
        uptime: 1000914,
        num_sta: 96,
        has_temperature: false,
        has_fan: false,
        overheating: false,
        temperatures: [
            {name: 'Local', type: 'board', value: 60.312},
            {name: 'CPU', type: 'cpu', value: 66.187},
        ],
        total_max_power: 30,
        total_used_power: 0,
        'system-stats': {cpu: '23.5', mem: '57.0', uptime: '1000914'},
        uplink: {comment: 'WAN', ip: '192.168.0.64', up: true, port_idx: 5, latency: 24, 'rx_bytes-r': 403555, 'tx_bytes-r': 59901},
        last_wan_status: {WAN: 'online'},
        last_wan_ip: '192.168.0.64',
        active_geo_info: {WAN: {address: '203.0.113.10', isp_name: 'Example ISP'}},
        wan1: {is_uplink: true, latency: 2},
        wan2: {is_uplink: false},
        uptime_stats: {
            WAN: {availability: 99.93060000240803, latency_average: 2},
            WAN2: {downtime: 1000842},
        },
        'speedtest-status': {rundate: 1795215948, xput_download: 939.0, xput_upload: 729.0, latency: 2},
        port_table: [
            port(4, 'Port 4', {port_poe: true}),
            port(5, 'Port 5', {up: true, speed: 1000, network_name: 'wan', is_uplink: true, 'rx_bytes-r': 403555, 'tx_bytes-r': 59901}),
            port(6, 'SFP+ 1', {up: true, speed: 10000}),
            port(7, 'SFP+ 2', {network_name: 'wan2'}),
        ],
        ...overrides,
    };
}

describe('parseGatewayStatus', () => {
    test('maps gateway and WAN sensors', () => {
        const {caps} = parseGatewayStatus(ucgFiber());
        expect(caps).toEqual({
            connected: true,
            ipAddress: '192.168.1.1',
            ports: 4,
            uptime: 1000914,
            measure_connected_clients: 96,
            alarm_overheating: false,
            measure_cpu_usage: 23.5,
            measure_memory_usage: 57,
            measure_uplink_rx: 3.23,
            measure_uplink_tx: 0.48,
            measure_device_temperature: 66.2,
            alarm_wan_down: false,
            wan_ip: '192.168.0.64',
            public_ip: '203.0.113.10',
            measure_wan_latency: 2,
            measure_wan_availability: 99.93,
            measure_speedtest_download: 939,
            measure_speedtest_upload: 729,
        });
    });

    test('labels WAN ports', () => {
        const {ports} = parseGatewayStatus(ucgFiber());
        expect(ports.map(p => p.name)).toEqual(['Port 4', 'Port 5 (WAN)', 'SFP+ 1', 'SFP+ 2 (WAN2)']);
    });

    test('reports the internet as down when no WAN is online', () => {
        const {caps} = parseGatewayStatus(ucgFiber({last_wan_status: {WAN: 'offline', WAN2: 'offline'}}));
        expect(caps.alarm_wan_down).toBe(true);
    });

    test('falls back to the uplink state without WAN status', () => {
        const {caps} = parseGatewayStatus(ucgFiber({last_wan_status: undefined, uplink: {up: false}}));
        expect(caps.alarm_wan_down).toBe(true);
    });

    test('skips speed test values when no test has run', () => {
        const {caps} = parseGatewayStatus(ucgFiber({'speedtest-status': {rundate: 0, xput_download: 0}}));
        expect(caps).not.toHaveProperty('measure_speedtest_download');
    });

    test('handles a minimal payload', () => {
        expect(parseGatewayStatus({mac: 'x'})).toEqual({caps: {}, ports: []});
    });
});
