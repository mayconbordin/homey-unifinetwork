'use strict';

const {parseAccessPointStatus} = require('../../library/ap-status');

// Trimmed from a U7 Pro XGS stat/device entry (Network 11.0.99)
function u7ProXgs(overrides = {}) {
    return {
        mac: '8c:30:66:76:a5:46',
        type: 'uap',
        satisfaction: 100,
        'system-stats': {cpu: '8.5', mem: '22.7', uptime: '462271'},
        uplink: {uplink_mac: '8c:30:66:a2:16:b6', uplink_remote_port: 1, 'rx_bytes-r': 4214692.5, 'tx_bytes-r': 76522.3},
        // UniFi lists radios in its own order; 6 GHz first here on purpose
        radio_table_stats: [
            {name: 'wifi2', radio: '6e', num_sta: 8, cu_total: 14},
            {name: 'wifi0', radio: 'ng', num_sta: 7, cu_total: 74},
            {name: 'wifi1', radio: 'na', num_sta: 2, cu_total: 15},
        ],
        ...overrides,
    };
}

describe('parseAccessPointStatus', () => {
    test('maps AP sensors and per-band values', () => {
        const {caps, bands} = parseAccessPointStatus(u7ProXgs());
        expect(caps).toEqual({
            measure_cpu_usage: 8.5,
            measure_memory_usage: 22.7,
            measure_uplink_rx: 33.72,
            measure_uplink_tx: 0.61,
            measure_wifi_experience: 100,
            'measure_connected_clients.2g': 7,
            'measure_connected_clients.5g': 2,
            'measure_connected_clients.6g': 8,
            'measure_channel_utilization.2g': 74,
            'measure_channel_utilization.5g': 15,
            'measure_channel_utilization.6g': 14,
        });
        expect(bands).toEqual(['2g', '5g', '6g']);
    });

    test('skips the Wi-Fi experience score when UniFi has none (-1)', () => {
        const {caps} = parseAccessPointStatus(u7ProXgs({satisfaction: -1}));
        expect(caps).not.toHaveProperty('measure_wifi_experience');
    });

    test('only reports the bands the AP has', () => {
        const {caps, bands} = parseAccessPointStatus(u7ProXgs({
            radio_table_stats: [{radio: 'ng', num_sta: 3, cu_total: 20}, {radio: 'na', num_sta: 5, cu_total: 10}],
        }));
        expect(bands).toEqual(['2g', '5g']);
        expect(caps).not.toHaveProperty('measure_connected_clients.6g');
    });

    test('handles a minimal payload', () => {
        expect(parseAccessPointStatus({mac: 'x'})).toEqual({caps: {}, bands: []});
    });
});
