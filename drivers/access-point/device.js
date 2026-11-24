'use strict';

const {Device} = require('homey');
const PoePowerMixin = require('../../library/poe-power-mixin');
const {parseFirmware} = require('../../library/switch-status');
const {parseAccessPointStatus, BAND_LABELS} = require('../../library/ap-status');

// Extra sensors, in display order. Each is only added once the AP reports it.
// Per-band ones are added after these, grouped by band.
const EXTRA_CAPABILITIES = [
    'measure_uplink_rx',
    'measure_uplink_tx',
    'measure_wifi_experience',
    'measure_cpu_usage',
    'measure_memory_usage',
    'alarm_firmware_update',
];

const BAND_CAPABILITIES = [
    {base: 'measure_connected_clients', title: band => `Clients ${BAND_LABELS[band]}`},
    {base: 'measure_channel_utilization', title: band => `Channel utilization ${BAND_LABELS[band]}`},
];

class AccessPointDevice extends PoePowerMixin(Device) {

    async onInit() {
        this._capabilityQueue = Promise.resolve();
        this._firmwareUpdateAvailable = null;
        await this.initPoeMeter(); // restore kWh total from store (from PoePowerMixin)
        await this.waitForBootstrap();
        this.log('Access-Point has been initialized');
    }

    async waitForBootstrap() {
        if (this.homey.app.loggedIn === true) {
            await this._createMissingCapabilities();
            await this.getDeviceStatus();
        } else {
            this.homey.setTimeout(this.waitForBootstrap.bind(this), 250);
        }
    }

    async onAdded() {
        this.log('Access-Point has been added');
    }

    async onDeleted() {
        this.destroyPoeMeter();
        this.log('Access-Point has been deleted');
    }

    async _createMissingCapabilities() {
        if (this.getClass() !== 'sensor') {
            this.homey.app.debug(`changed class to sensor for ${this.getName()}`);
            this.setClass('sensor').catch(this.error);
        }

        for (const cap of ['connected', 'ipAddress', 'measure_connected_clients', 'uptime']) {
            if (!this.hasCapability(cap)) {
                await this.addCapability(cap);
                this.homey.app.debug(`created capability ${cap} for ${this.getName()}`);
            }
        }
        // Everything else is added dynamically once the AP reports it
    }

    /**
     * Run capability changes one at a time. Homey rejects concurrent
     * addCapability calls.
     */
    _enqueue(task) {
        this._capabilityQueue = this._capabilityQueue.then(task).catch(this.error);
        return this._capabilityQueue;
    }

    async _addCapabilityIfMissing(cap, title = null) {
        if (this.hasCapability(cap)) return;
        await this.addCapability(cap);
        if (title) await this.setCapabilityOptions(cap, {title: {en: title}});
        this.homey.app.debug(`created capability ${cap} for ${this.getName()}`);
    }

    _setValue(cap, value) {
        if (!this.hasCapability(cap) || value === null || typeof value === 'undefined') return;
        if (this.getCapabilityValue(cap) === value) return;
        this.setCapabilityValue(cap, value).catch(this.error);
    }

    /**
     * Update the extra sensors (CPU, uplink, per-band clients, ...).
     * @param {object} data      AP object from stat/device or device:sync
     * @param {boolean} fromRest true when `data` came from the REST API, which is
     *                           the only source trusted for firmware status
     */
    async _applyExtras(data, fromRest) {
        const {caps, bands} = parseAccessPointStatus(data);
        const firmware = fromRest ? parseFirmware(data) : null;
        if (firmware) caps.alarm_firmware_update = firmware.updateAvailable;

        await this._enqueue(async () => {
            for (const cap of EXTRA_CAPABILITIES) {
                if (cap in caps) await this._addCapabilityIfMissing(cap);
            }
            for (const band of bands) {
                for (const {base, title} of BAND_CAPABILITIES) {
                    const cap = `${base}.${band}`;
                    if (cap in caps) await this._addCapabilityIfMissing(cap, title(band));
                }
            }
        });

        for (const [cap, value] of Object.entries(caps)) {
            this._setValue(cap, value);
        }
        if (firmware) this._updateFirmware(firmware);
    }

    _updateFirmware(firmware) {
        if (this._firmwareUpdateAvailable === false && firmware.updateAvailable) {
            this.driver.firmwareUpdateAvailable.trigger(this, {
                current_version: firmware.version,
                new_version: firmware.latestVersion,
            }).catch(this.error);
        }
        this._firmwareUpdateAvailable = firmware.updateAvailable;
    }

    async getDeviceStatus() {
        if (this.homey.app.loggedIn !== true) return;
        const mac = this.getData().id;
        try {
            const devices = await this.homey.app.api.unifi.getAccessDevices(mac);
            const apData = (devices || []).find(obj => obj.adopted === true && obj.type === 'uap' && obj.mac === mac);
            if (!apData) return;

            this.onUpdateMessagePayload(apData, {fromRest: true});
            // Seed initial PoE readings (from PoePowerMixin)
            if (this._swMac && this._swPort) {
                this._fetchPoeData(this._swMac, this._swPort);
            }
        } catch (error) {
            this.homey.app.debug(error);
        }
    }

    /**
     * Mapping from UniFi radio-type prefix to capability band suffix.
     * AP stats use: ng = 2.4 GHz, na = 5 GHz, 6e = 6 GHz (confirmed from Wi-Fi 7 payload)
     */
    _radioPrefixToBand(prefix) {
        if (prefix === 'ng') return '2g';
        if (prefix === 'na') return '5g';
        if (prefix === '6e' || prefix === '6g') return '6g';
        return null;
    }

    /**
     * Create/update per-radio traffic capabilities from the AP device payload.
     * Uses ng-/na-/6e- radio-type prefixes which are stable across AP generations
     * (ra0/rai0 on Wi-Fi 5/6 and wifi0/wifi1/wifi2 on Wi-Fi 7 both map to the same prefixes).
     */
    _updatePerRadioStats(apData) {
        const values = {};
        for (const prefix of ['ng', 'na', '6e']) {
            const band = this._radioPrefixToBand(prefix);
            for (const dir of ['rx', 'tx']) {
                const raw = apData[`${prefix}-${dir}_bytes`];
                // Only create capabilities when data is actually present in the API response
                if (typeof raw === 'number') {
                    values[`measure_${dir}_bytes_${band}`] = Math.round((raw * 0.000001) * 100) / 100;
                }
            }
        }
        if (Object.keys(values).length === 0) return;

        this._enqueue(async () => {
            for (const cap of Object.keys(values)) await this._addCapabilityIfMissing(cap);
        }).then(() => {
            for (const [cap, value] of Object.entries(values)) this._setValue(cap, value);
        });
    }

    /**
     * Update from an AP object: real-time `device:sync` messages and the app's
     * periodic REST poll (which passes `{fromRest: true}`).
     */
    onUpdateMessagePayload(playloadMessage, {fromRest = false} = {}) {
        if (typeof playloadMessage.ip !== 'undefined') {
            this.onIPChange(playloadMessage);
        }
        if (typeof playloadMessage.state === 'number') {
            this.onIsConnected(playloadMessage.state === 1);
        }
        if (typeof playloadMessage.num_sta === 'number') {
            this.onNumClientsChange(playloadMessage.num_sta);
        }
        if (typeof playloadMessage.uptime === 'number') {
            this.onUptimeChange(playloadMessage.uptime);
        }
        this._updatePerRadioStats(playloadMessage);
        this._applyExtras(playloadMessage, fromRest).catch(this.error);
        // Keep uplink info up to date for real-time device:sync power pushes
        this.updatePoeUplink(playloadMessage);
    }

    onIsConnected(isConnected) {
        const prevConnected = this.getCapabilityValue('connected');

        if (this.hasCapability('connected')) {
            this.setCapabilityValue('connected', isConnected).catch(this.error);
        }

        if (prevConnected !== isConnected) {
            if (isConnected) {
                this.homey.app._accessPointConnected.trigger(this, {}, {}).catch(this.error);
            } else {
                this.homey.app._accessPointDisconnected.trigger(this, {}, {}).catch(this.error);
            }
        }
    }

    onNumClientsChange(numClients) {
        const prevNum = this.getCapabilityValue('measure_connected_clients');

        if (this.hasCapability('measure_connected_clients')) {
            this.setCapabilityValue('measure_connected_clients', numClients).catch(this.error);
        }

        if (prevNum !== null && prevNum !== numClients) {
            const tokens = { num_clients: numClients };
            this.homey.app._accessPointClientCountChanged.trigger(this, tokens, {}).catch(this.error);
        }
    }

    onUptimeChange(uptime) {
        if (this.hasCapability('uptime')) {
            this.setCapabilityValue('uptime', uptime).catch(this.error);
        }
    }

    onIPChange(data) {
        if (this.hasCapability('ipAddress')) {
            this.setCapabilityValue('ipAddress', data.ip).catch(this.error);
        }
    }
}

module.exports = AccessPointDevice;
