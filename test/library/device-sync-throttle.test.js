'use strict';

const DeviceSyncThrottle = require('../../library/device-sync-throttle');

describe('DeviceSyncThrottle', () => {
    let now;
    let throttle;
    const sw = (overrides = {}) => ({
        mac: 'aa:bb:cc:00:00:01', state: 1, num_sta: 3, ip: '10.0.0.2',
        port_table: [{ up: true, poe_enable: true }, { up: false, poe_enable: false }],
        ...overrides,
    });

    beforeEach(() => {
        now = 1000;
        throttle = new DeviceSyncThrottle({ minIntervalMs: 10000, now: () => now });
    });

    it('processes the first message for a device', () => {
        expect(throttle.shouldProcess(sw())).toBe(true);
    });

    it('drops unchanged messages inside the interval and allows them after', () => {
        throttle.shouldProcess(sw());
        now += 5000;
        expect(throttle.shouldProcess(sw({ uptime: 123 }))).toBe(false);
        now += 5000;
        expect(throttle.shouldProcess(sw())).toBe(true);
    });

    it.each([
        ['state', { state: 0 }],
        ['client count', { num_sta: 4 }],
        ['port link', { port_table: [{ up: false, poe_enable: true }, { up: false, poe_enable: false }] }],
        ['PoE', { port_table: [{ up: true, poe_enable: false }, { up: false, poe_enable: false }] }],
    ])('processes immediately when %s changes', (_label, change) => {
        throttle.shouldProcess(sw());
        now += 100;
        expect(throttle.shouldProcess(sw(change))).toBe(true);
    });

    it('tracks devices independently', () => {
        throttle.shouldProcess(sw());
        expect(throttle.shouldProcess(sw({ mac: 'aa:bb:cc:00:00:02' }))).toBe(true);
    });

    it('ignores payloads without a MAC', () => {
        expect(throttle.shouldProcess({ state: 1 })).toBe(false);
    });
});
