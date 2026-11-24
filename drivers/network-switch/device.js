'use strict';

const {Device} = require('homey');
const PoePowerMixin = require('../../library/poe-power-mixin');
const {parseSwitchStatus} = require('../../library/switch-status');

// Real-time updates arrive over the WebSocket; polling is a fallback for when
// it is not available (API key without username/password).
const POLL_INTERVAL_MS = 60 * 1000;

// Bump to rebuild capabilities in SENSOR_CAPABILITIES order on existing devices.
const CAPABILITY_LAYOUT_VERSION = 3;

// Device-level sensors, in display order. Each is only added once the switch reports it.
const SENSOR_CAPABILITIES = [
    'connected',
    'ipAddress',
    'ports',
    'uptime',
    'measure_connected_clients',
    'measure_poe_power',
    'measure_poe_budget',
    'measure_uplink_rx',
    'measure_uplink_tx',
    'measure_device_temperature',
    'alarm_overheating',
    'measure_fan_level',
    'measure_cpu_usage',
    'measure_memory_usage',
];

class NetworkSwitchDevice extends PoePowerMixin(Device) {

    async onInit() {
        this._capabilityQueue = Promise.resolve();
        this._poeListeners = new Set();
        this._ready = false; // ignore real-time updates until _migrate() has finished
        await this.initPoeMeter(); // restore kWh total from store (from PoePowerMixin)
        await this.waitForBootstrap();
        this.log('Network-Switch has been initialized');
    }

    async waitForBootstrap() {
        if (this.homey.app.loggedIn === true) {
            await this._enqueue(() => this._migrate());
            this._ready = true;
            await this.getDeviceStatus();
            if (!this._pollInterval) {
                this._pollInterval = this.homey.setInterval(() => this.getDeviceStatus(), POLL_INTERVAL_MS);
            }
        } else {
            this.homey.setTimeout(this.waitForBootstrap.bind(this), 250);
        }
    }

    async onAdded() {
        this.log('Network-Switch has been added');
    }

    async onDeleted() {
        this.destroyPoeMeter();
        if (this._pollInterval) {
            this.homey.clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
        this.log('Network-Switch has been deleted');
    }

    /** Clean up devices paired with older versions of the app. */
    async _migrate() {
        if (this.getClass() !== 'sensor') {
            await this.setClass('sensor').catch(this.error);
        }
        // Old versions exposed an on/off button that did nothing
        if (this.hasCapability('onoff')) {
            await this.removeCapability('onoff').catch(this.error);
        }
        // Old versions added capabilities in random order (and only some of them).
        // Remove them once so they are re-added in display order.
        if (this.getStoreValue('capabilityLayout') !== CAPABILITY_LAYOUT_VERSION) {
            for (const cap of this.getCapabilities()) {
                if (SENSOR_CAPABILITIES.includes(cap) || cap.startsWith('port.') || cap.startsWith('poe.')) {
                    await this.removeCapability(cap).catch(this.error);
                    await this.unsetStoreValue(`title:${cap}`).catch(this.error);
                }
            }
            await this.setStoreValue('capabilityLayout', CAPABILITY_LAYOUT_VERSION);
        }
    }

    /**
     * Run capability changes one at a time. Homey rejects concurrent
     * addCapability calls, which used to leave switches with only a few ports.
     */
    _enqueue(task) {
        this._capabilityQueue = this._capabilityQueue.then(task).catch(this.error);
        return this._capabilityQueue;
    }

    async _ensureCapabilities(status) {
        for (const cap of SENSOR_CAPABILITIES) {
            if (cap in status.caps && !this.hasCapability(cap)) {
                await this.addCapability(cap);
            }
        }

        for (const port of status.ports) {
            const linkCap = `port.port_${port.idx}`;
            if (!this.hasCapability(linkCap)) await this.addCapability(linkCap);
            await this._setTitle(linkCap, port.name);

            if (port.poeCapable) {
                const poeCap = `poe.port_${port.idx}`;
                if (!this.hasCapability(poeCap)) await this.addCapability(poeCap);
                await this._setTitle(poeCap, `PoE ${port.name}`);
                this._registerPoeListener(poeCap, port.idx);
            }
        }
    }

    /** Use the port name from UniFi (e.g. "SFP+ 1", or a custom name) as the capability title. */
    async _setTitle(cap, title) {
        const key = `title:${cap}`;
        if (this.getStoreValue(key) === title) return;
        await this.setCapabilityOptions(cap, {title: {en: title}});
        await this.setStoreValue(key, title);
    }

    _registerPoeListener(cap, portIdx) {
        if (this._poeListeners.has(cap)) return;
        this._poeListeners.add(cap);
        this.registerCapabilityListener(cap, async (value) => {
            const api = this.homey.app.api;
            const mac = this.getData().id;
            if (value) {
                await api.powerOnDevice(mac, portIdx);
            } else {
                await api.powerOffDevice(mac, portIdx);
            }
        });
    }

    _setValue(cap, value) {
        if (!this.hasCapability(cap) || value === null || typeof value === 'undefined') return;
        if (this.getCapabilityValue(cap) === value) return;
        this.setCapabilityValue(cap, value).catch(this.error);
    }

    async _applyStatus(data) {
        const status = parseSwitchStatus(data);
        await this._enqueue(() => this._ensureCapabilities(status));

        for (const [cap, value] of Object.entries(status.caps)) {
            this._setValue(cap, value);
        }
        for (const port of status.ports) {
            this._setValue(`port.port_${port.idx}`, port.up);
            if (port.poeCapable) this._setValue(`poe.port_${port.idx}`, port.poeEnabled);
        }
    }

    /** Real-time update from a `device:sync` WebSocket message. */
    onStatusChange(data) {
        if (!this._ready) return;
        this._applyStatus(data).catch(this.error);
    }

    async getDeviceStatus() {
        if (this.homey.app.loggedIn !== true) return;
        const mac = this.getData().id;
        try {
            const devices = await this.homey.app.api.unifi.getAccessDevices(mac);
            // Filter by MAC so we always use this switch's own data
            const data = (devices || []).find(obj => obj.mac === mac);
            if (!data) return;

            await this._applyStatus(data);

            // If this switch is itself PoE-powered by an upstream switch, track its own draw
            this.updatePoeUplink(data);
            if (this._swMac && this._swPort) {
                this._fetchPoeData(this._swMac, this._swPort);
            }
        } catch (error) {
            this.homey.app.debug(error);
        }
    }
}

module.exports = NetworkSwitchDevice;
