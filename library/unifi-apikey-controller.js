'use strict';

const https = require('https');

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * UniFi Network client that authenticates with an API key (X-API-KEY header).
 *
 * Exposes the subset of the node-unifi Controller interface used by this app, so
 * drivers can call `api.unifi.getClientDevices()` etc. regardless of auth mode.
 *
 * On UniFi OS (Network 9.x+) the API key is accepted by:
 *  - the official integration API: /proxy/network/integration/v1/...
 *  - the classic controller API:   /proxy/network/api/s/<site>/...
 * It is NOT accepted by the events WebSocket (closes with api.err.LoginRequired),
 * so real-time events still need a username/password session.
 */
class UnifiApiKeyController {
    constructor({host, port = 443, site = 'default', sslverify = false, apiKey, timeout = DEFAULT_TIMEOUT_MS}) {
        if (!apiKey) throw new Error('API key is required');
        this._host = host;
        this._port = Number.parseInt(port, 10) || 443;
        this._site = site || 'default';
        this._sslverify = sslverify === true;
        this._apiKey = apiKey;
        this._timeout = timeout;
        this._unifios = true;
        this._integrationSiteId = null;
        this.isApiKey = true;
    }

    /**
     * Low-level HTTPS request against the controller.
     * Rejects with an Error whose message contains the HTTP status code (so
     * ErrorHandler.is401Error() picks up auth failures) and exposes `.response.status`.
     */
    request(method, path, body = null) {
        return new Promise((resolve, reject) => {
            const payload = body === null || typeof body === 'undefined' ? null : JSON.stringify(body);
            const headers = {
                'X-API-KEY': this._apiKey,
                Accept: 'application/json',
            };
            if (payload !== null) {
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(payload);
            }

            const req = https.request({
                hostname: this._host,
                port: this._port,
                path,
                method,
                headers,
                rejectUnauthorized: this._sslverify,
                timeout: this._timeout,
            }, (res) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let json = null;
                    try { json = text ? JSON.parse(text) : null; } catch (_e) { /* non-JSON body */ }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        return resolve(json !== null ? json : text);
                    }

                    const detail = (json && (json.message || (json.meta && json.meta.msg) || (json.error && json.error.message)))
                        || text.slice(0, 200) || res.statusMessage;
                    const err = new Error(`HTTP ${res.statusCode} ${method} ${path}: ${detail}`);
                    err.response = {status: res.statusCode, data: json || text};
                    reject(err);
                });
            });

            req.on('timeout', () => {
                req.destroy(new Error(`Request timeout after ${this._timeout}ms (${method} ${path})`));
            });
            req.on('error', reject);
            if (payload !== null) req.write(payload);
            req.end();
        });
    }

    /** Call the classic controller API and unwrap the {meta, data} envelope. */
    async _legacy(method, path, body = null) {
        const sitePath = path.replace('<SITE>', encodeURIComponent(this._site));
        const res = await this.request(method, `/proxy/network${sitePath}`, body);
        if (res && res.meta && res.meta.rc && res.meta.rc !== 'ok') {
            throw new Error(`UniFi API error: ${res.meta.msg || res.meta.rc}`);
        }
        return res && Array.isArray(res.data) ? res.data : res;
    }

    /** Call the official integration API (path relative to /integration/v1). */
    integration(method, path, body = null) {
        return this.request(method, `/proxy/network/integration/v1${path}`, body);
    }

    /** Fetch every page of a paginated integration list endpoint. */
    async integrationList(path) {
        const results = [];
        const limit = 200;
        let offset = 0;
        for (;;) {
            const sep = path.includes('?') ? '&' : '?';
            const page = await this.integration('GET', `${path}${sep}offset=${offset}&limit=${limit}`);
            const data = page && Array.isArray(page.data) ? page.data : [];
            results.push(...data);
            offset += data.length;
            if (data.length === 0 || offset >= (page.totalCount || 0)) break;
        }
        return results;
    }

    /** Resolve the configured site short name (e.g. "default") to its integration API UUID. */
    async getIntegrationSiteId() {
        if (this._integrationSiteId) return this._integrationSiteId;
        const sites = await this.integrationList('/sites');
        const site = sites.find(s => s.internalReference === this._site || s.id === this._site)
            || (sites.length === 1 ? sites[0] : null);
        if (!site) throw new Error(`Site "${this._site}" not found`);
        this._integrationSiteId = site.id;
        return site.id;
    }

    /** Look up an integration-API device UUID by MAC address. */
    async getIntegrationDeviceId(mac) {
        const siteId = await this.getIntegrationSiteId();
        const devices = await this.integrationList(`/sites/${siteId}/devices`);
        const device = devices.find(d => (d.macAddress || '').toLowerCase() === mac.toLowerCase());
        if (!device) throw new Error(`Device ${mac} not found`);
        return {siteId, deviceId: device.id};
    }

    // --- node-unifi compatible surface -------------------------------------

    /** Validates the API key and site. Username/password are ignored. */
    async login() {
        await this.integration('GET', '/info');
        const sites = await this.getSites();
        if (!sites.some(s => s.name === this._site)) {
            throw new Error(`Site "${this._site}" not found on controller`);
        }
        return true;
    }

    async logout() {
        return true;
    }

    getSites() {
        return this._legacy('GET', '/api/self/sites');
    }

    getClientDevices(mac = '') {
        return this._legacy('GET', `/api/s/<SITE>/stat/sta/${mac.trim().toLowerCase()}`);
    }

    getClientDevice(mac = '') {
        return this._legacy('GET', `/api/s/<SITE>/stat/user/${mac.trim().toLowerCase()}`);
    }

    getAccessDevices(mac = '') {
        return this._legacy('GET', `/api/s/<SITE>/stat/device/${mac.trim().toLowerCase()}`);
    }

    getAllUsers(within = 8760) {
        return this._legacy('POST', '/api/s/<SITE>/stat/alluser', {type: 'all', conn: 'all', within});
    }

    getUsers() {
        return this._legacy('GET', '/api/s/<SITE>/list/user');
    }

    getWLanSettings() {
        return this._legacy('GET', '/api/s/<SITE>/rest/wlanconf');
    }

    setWLanSettingsBase(wlanId, payload) {
        return this._legacy('PUT', `/api/s/<SITE>/rest/wlanconf/${wlanId.trim()}`, payload);
    }

    blockClient(mac) {
        return this._legacy('POST', '/api/s/<SITE>/cmd/stamgr', {cmd: 'block-sta', mac: mac.toLowerCase()});
    }

    unblockClient(mac) {
        return this._legacy('POST', '/api/s/<SITE>/cmd/stamgr', {cmd: 'unblock-sta', mac: mac.toLowerCase()});
    }

    /** Blink (or stop blinking) the LED of an adopted device. Works for switches too. */
    setLocateAccessPoint(mac, enable) {
        return this._legacy('POST', '/api/s/<SITE>/cmd/devmgr', {cmd: enable === true ? 'set-locate' : 'unset-locate', mac: mac.toLowerCase()});
    }

    setDeviceSettingsBase(deviceId, payload) {
        return this._legacy('PUT', `/api/s/<SITE>/rest/device/${deviceId.trim()}`, payload);
    }
}

module.exports = UnifiApiKeyController;
