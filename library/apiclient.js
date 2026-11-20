'use strict';

const BaseClass = require('./baseclass');
const Unifi = require('node-unifi');
const WebsocketClient = require('./websocket');
const UnifiApiKeyController = require('./unifi-apikey-controller');

class ApiClient extends BaseClass {

    constructor({homey}) {
        super();
        this.unifi = null;          // REST client (API-key controller or node-unifi session)
        this.sessionUnifi = null;   // node-unifi session used only for the events WebSocket
        this.websocket = null;
        this.homey = homey;
        this.loggedInStatus = 0;
    }

    /**
     * Create the REST client. With an API key the controller is accessed via the
     * X-API-KEY header (UniFi OS / Network 9+). Without one we fall back to a
     * username/password session through node-unifi (older controllers).
     */
    setUnifiObject(hostName, portNumber, userName, passWord, siteName, sslVerify, apiKey = null) {
        // Migration shim: if sslVerify is undefined (existing installs) default to false
        const sslverify = typeof sslVerify === 'boolean' ? sslVerify : false;
        const site = siteName || 'default';
        const port = portNumber || 443;
        this.sessionUnifi = null;

        if (apiKey) {
            this.unifi = new UnifiApiKeyController({host: hostName, port, site, sslverify, apiKey});
        } else {
            this.unifi = new Unifi.Controller({host: hostName, port, sslverify, site});
        }

        return this.unifi;
    }

    /** True when REST calls use an API key. */
    usesApiKey() {
        return !!(this.unifi && this.unifi.isApiKey);
    }

    /**
     * Log in to the controller. In API-key mode this validates the key; in
     * session mode it performs the username/password login.
     */
    async login(userName, passWord) {
        return this.unifi.login(userName, passWord);
    }

    async logout() {
        if (this.sessionUnifi) {
            try { await this.sessionUnifi.logout(); } catch (_e) { /* ignore */ }
        }
        if (this.unifi) {
            await this.unifi.logout();
        }
    }

    /**
     * The events WebSocket only accepts a session cookie, not an API key.
     * Returns the node-unifi controller holding that session, logging in on demand
     * (API-key mode) or reusing the REST session (password mode).
     */
    async getWebsocketSession(hostName, portNumber, userName, passWord, siteName, sslVerify) {
        if (!this.usesApiKey()) return this.unifi;
        if (!userName || !passWord) return null;
        const sslverify = typeof sslVerify === 'boolean' ? sslVerify : false;
        const session = new Unifi.Controller({host: hostName, port: portNumber || 443, sslverify, site: siteName || 'default'});
        await session.login(userName, passWord);
        this.sessionUnifi = session;
        return session;
    }

    setWebSocketObject(hostName, portNumber, userName, passWord, siteName, sslVerify, session = null) {
        // Cleanly shut down old client (stops reconnect loop + terminates socket)
        if (this.websocket) {
            this.websocket.destroy();
        }
        const sslverify = typeof sslVerify === 'boolean' ? sslVerify : false;
        const options = {host: hostName, port: portNumber, sslverify, site: siteName};
        this.websocket = new WebsocketClient(options, this.homey, session || this.unifi);
    }

    async getSites() {
        return this.unifi.getSites();
    }

    async getAccessPoints() {
        const response = await this.unifi.getAccessDevices();
        if (!Array.isArray(response)) throw new Error('Error obtaining AccessPoint devices.');
        return response.filter(obj => obj.adopted === true && obj.type === 'uap');
    }

    async getWiFiDevices() {
        const response = await this.unifi.getClientDevices();
        if (!Array.isArray(response)) throw new Error('Error obtaining WiFi devices.');
        return response.filter(obj => obj.is_wired === false);
    }

    async getCableDevices() {
        const response = await this.unifi.getClientDevices();
        if (!Array.isArray(response)) throw new Error('Error obtaining cable devices.');
        return response.filter(obj => obj.is_wired === true);
    }

    async getNetworkSwitches() {
        const response = await this.unifi.getAccessDevices();
        if (!Array.isArray(response)) throw new Error('Error obtaining network switches.');
        return response.filter(obj => obj.type === 'usw');
    }

    /** Get a single adopted device (switch / AP) from /stat/device by MAC. */
    async _getDevice(macAddress) {
        const deviceData = await this.unifi.getAccessDevices(macAddress);
        const device = (deviceData || []).find(obj => obj.mac === macAddress);
        if (!device) throw new Error(`Device ${macAddress} not found`);
        return device;
    }

    /**
     * Set the PoE mode of a switch port via port_overrides. Ports without an
     * existing override get one added (UniFi only lists customised ports).
     */
    async _setPoeMode(macAddress, portIndex, poeMode) {
        const device = await this._getDevice(macAddress);
        const portIdx = Number.parseInt(portIndex, 10);
        const portOverrides = Array.isArray(device.port_overrides) ? device.port_overrides : [];
        const override = portOverrides.find(item => item.port_idx === portIdx);
        if (override) {
            override.poe_mode = poeMode;
        } else {
            portOverrides.push({port_idx: portIdx, poe_mode: poeMode});
        }
        await this.unifi.setDeviceSettingsBase(device._id, {port_overrides: portOverrides});
    }

    async powerOnDevice(macAddress, portIndex) {
        return this._setPoeMode(macAddress, portIndex, 'auto');
    }

    async powerOffDevice(macAddress, portIndex) {
        return this._setPoeMode(macAddress, portIndex, 'off');
    }

    async powerCycleDevice(macAddress, portIndex) {
        const portIdx = Number.parseInt(portIndex, 10);
        if (this.usesApiKey()) {
            const {siteId, deviceId} = await this.unifi.getIntegrationDeviceId(macAddress);
            return this.unifi.integration('POST', `/sites/${siteId}/devices/${deviceId}/interfaces/ports/${portIdx}/actions`, {action: 'POWER_CYCLE'});
        }
        return this.unifi.powerCycleSwitchPort(macAddress, portIdx);
    }

    /**
     * Restart (reboot) an adopted device (e.g. an access point).
     * @param {string} macAddress
     */
    async restartAccessPoint(macAddress) {
        if (this.usesApiKey()) {
            const {siteId, deviceId} = await this.unifi.getIntegrationDeviceId(macAddress);
            return this.unifi.integration('POST', `/sites/${siteId}/devices/${deviceId}/actions`, {action: 'RESTART'});
        }
        return this.unifi.restartDevice(macAddress);
    }

    /** List the site's WLANs (SSIDs). */
    async getWlans() {
        const wlans = await this.unifi.getWLanSettings();
        return Array.isArray(wlans) ? wlans : [];
    }

    /**
     * Enable or disable a WLAN. Uses the classic wlanconf endpoint because the
     * integration API only supports full-object PUTs that require the passphrase.
     */
    async setWlanEnabled(wlanId, enabled) {
        return this.unifi.setWLanSettingsBase(wlanId, {enabled: enabled === true});
    }

    getDeviceName(payload) {
        let deviceName = payload.name
        if (typeof deviceName === 'undefined' && typeof payload.hostname !== 'undefined') deviceName = payload.hostname;
        if (typeof deviceName === 'undefined' && typeof payload.mac !== 'undefined') deviceName = payload.mac;
        if (typeof deviceName === 'undefined' && typeof payload.user !== 'undefined') deviceName = payload.user;
        if (typeof deviceName === 'undefined') deviceName = "unknown";
        return deviceName;
    }

    /** Find a known client (online or offline) by MAC. Resolves to the record or null. */
    async getDeviceByMac(macAddress) {
        const users = await this.unifi.getClientDevice(macAddress);
        return (users || []).find(obj => obj.mac === macAddress) || null;
    }

    /**
     * Fetch per-radio statistics for a specific AP from /stat/device.
     * Returns an object with radio prefix keys: ng-rx_bytes, na-rx_bytes, 6e-rx_bytes, etc.
     * @param {string} mac  AP MAC address
     * @returns {Promise<object|null>}
     */
    async getAccessPointStats(mac) {
        const response = await this.unifi.getAccessDevices(mac);
        const ap = (response || []).find(obj => obj.mac === mac);
        if (!ap) return null;
        const stats = {};
        for (const prefix of ['ng', 'na', '6e']) {
            for (const field of ['rx_bytes', 'tx_bytes', 'rx_packets', 'tx_packets']) {
                const key = `${prefix}-${field}`;
                if (typeof ap[key] === 'number') stats[key] = ap[key];
            }
        }
        return stats;
    }
}

module.exports = ApiClient;
