'use strict';

// Mock the homey SDK so BaseClass (which extends Homey.SimpleClass) can be instantiated
jest.mock('homey', () => {
    class SimpleClass {
        constructor() {}
        log(...args) {}
        error(...args) {}
        debug(...args) {}
    }
    return { SimpleClass };
});

// Mock node-unifi before requiring ApiClient
jest.mock('node-unifi', () => ({
    Controller: jest.fn().mockImplementation(() => ({
        login: jest.fn().mockResolvedValue(true),
        logout: jest.fn().mockResolvedValue(true),
        getClientDevices: jest.fn().mockResolvedValue([
            { mac: 'aa:bb:cc:dd:ee:ff', is_wired: false, essid: 'TestSSID', hostname: 'MyPhone', ip: '192.168.1.100' },
            { mac: '11:22:33:44:55:66', is_wired: true, hostname: 'MyPC', ip: '192.168.1.101' },
        ]),
        getAccessDevices: jest.fn().mockResolvedValue([
            { mac: 'dd:ee:ff:00:11:22', type: 'uap', adopted: true, name: 'LivingRoomAP', ip: '192.168.1.2' },
            { mac: 'aa:bb:cc:11:22:33', type: 'usw', adopted: true, name: 'MainSwitch', ip: '192.168.1.3' },
        ]),
        blockClient: jest.fn().mockResolvedValue(true),
        unblockClient: jest.fn().mockResolvedValue(true),
        setDeviceSettingsBase: jest.fn().mockResolvedValue(true),
        powerCycleSwitchPort: jest.fn().mockResolvedValue(true),
        getAllUsers: jest.fn().mockResolvedValue([
            { mac: 'aa:bb:cc:dd:ee:ff', name: 'MyPhone', is_guest: false },
        ]),
        _unifios: false,
        _isClosed: false,
    })),
}));

// Minimal Homey mock
const mockHomey = {
    app: {
        debug: jest.fn(),
        error: jest.fn(),
        loggedIn: true,
    },
    error: jest.fn(),
    log: jest.fn(),
};

const ApiClient = require('../../library/apiclient');

describe('ApiClient', () => {
    let client;

    beforeEach(() => {
        client = new ApiClient({ homey: mockHomey });
        client.setUnifiObject('192.168.1.1', 443, 'admin', 'password', 'default');
    });

    describe('getWiFiDevices()', () => {
        it('returns only wireless clients (is_wired: false)', async () => {
            const devices = await client.getWiFiDevices();
            expect(devices).toHaveLength(1);
            expect(devices[0].mac).toBe('aa:bb:cc:dd:ee:ff');
            expect(devices[0].is_wired).toBe(false);
        });
    });

    describe('getCableDevices()', () => {
        it('returns only wired clients (is_wired: true)', async () => {
            const devices = await client.getCableDevices();
            expect(devices).toHaveLength(1);
            expect(devices[0].mac).toBe('11:22:33:44:55:66');
            expect(devices[0].is_wired).toBe(true);
        });
    });

    describe('getAccessPoints()', () => {
        it('returns only adopted UAPs', async () => {
            const aps = await client.getAccessPoints();
            expect(aps).toHaveLength(1);
            expect(aps[0].type).toBe('uap');
            expect(aps[0].adopted).toBe(true);
        });
    });

    describe('getNetworkSwitches()', () => {
        it('returns only USW devices', async () => {
            const switches = await client.getNetworkSwitches();
            expect(switches).toHaveLength(1);
            expect(switches[0].type).toBe('usw');
        });
    });

    describe('getDeviceName()', () => {
        it('uses name field first', () => {
            expect(client.getDeviceName({ name: 'MyDevice', hostname: 'host', mac: 'aa:bb' })).toBe('MyDevice');
        });

        it('falls back to hostname when name is undefined', () => {
            expect(client.getDeviceName({ hostname: 'myhost', mac: 'aa:bb' })).toBe('myhost');
        });

        it('falls back to mac when name and hostname are undefined', () => {
            expect(client.getDeviceName({ mac: 'aa:bb:cc:dd:ee:ff' })).toBe('aa:bb:cc:dd:ee:ff');
        });

        it('falls back to user field', () => {
            expect(client.getDeviceName({ user: 'aa:bb:cc:dd:ee:ff' })).toBe('aa:bb:cc:dd:ee:ff');
        });

        it('returns "unknown" when all fields are undefined', () => {
            expect(client.getDeviceName({})).toBe('unknown');
        });
    });

    describe('powerCycleDevice()', () => {
        it('uses the power-cycle command in username/password mode', async () => {
            await client.powerCycleDevice('aa:bb:cc:11:22:33', '3');
            expect(client.unifi.powerCycleSwitchPort).toHaveBeenCalledWith('aa:bb:cc:11:22:33', 3);
        });

        it('uses the integration POWER_CYCLE action in API-key mode', async () => {
            client.setUnifiObject('192.168.1.1', 443, '', '', 'default', false, 'test-key');
            client.unifi.getIntegrationDeviceId = jest.fn().mockResolvedValue({ siteId: 'site-uuid', deviceId: 'dev-uuid' });
            client.unifi.integration = jest.fn().mockResolvedValue({});
            await client.powerCycleDevice('aa:bb:cc:11:22:33', 3);
            expect(client.unifi.integration).toHaveBeenCalledWith(
                'POST', '/sites/site-uuid/devices/dev-uuid/interfaces/ports/3/actions', { action: 'POWER_CYCLE' });
        });
    });

    describe('powerOffDevice() / powerOnDevice()', () => {
        const mac = 'aa:bb:cc:11:22:33';

        it('updates an existing port override', async () => {
            client.unifi.getAccessDevices.mockResolvedValueOnce([
                { mac, _id: 'sw-1', port_overrides: [{ port_idx: 2, poe_mode: 'auto', name: 'Cam' }] },
            ]);
            await client.powerOffDevice(mac, '2');
            expect(client.unifi.setDeviceSettingsBase).toHaveBeenCalledWith('sw-1', {
                port_overrides: [{ port_idx: 2, poe_mode: 'off', name: 'Cam' }],
            });
        });

        it('adds an override when the port has none (UniFi only lists customised ports)', async () => {
            client.unifi.getAccessDevices.mockResolvedValueOnce([{ mac, _id: 'sw-1', port_overrides: [] }]);
            await client.powerOnDevice(mac, 5);
            expect(client.unifi.setDeviceSettingsBase).toHaveBeenCalledWith('sw-1', {
                port_overrides: [{ port_idx: 5, poe_mode: 'auto' }],
            });
        });

        it('rejects when the switch is not found', async () => {
            client.unifi.getAccessDevices.mockResolvedValueOnce([]);
            await expect(client.powerOffDevice(mac, 1)).rejects.toThrow('not found');
        });
    });

    describe('API-key mode', () => {
        it('creates an API-key controller when a key is given', () => {
            client.setUnifiObject('192.168.1.1', 443, '', '', 'default', false, 'test-key');
            expect(client.usesApiKey()).toBe(true);
        });

        it('has no WebSocket session without username/password', async () => {
            client.setUnifiObject('192.168.1.1', 443, '', '', 'default', false, 'test-key');
            await expect(client.getWebsocketSession('192.168.1.1', 443, '', '', 'default', false)).resolves.toBeNull();
        });
    });
});

