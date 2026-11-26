'use strict';

const NetworkSwitchDevice = require('../network-switch/device');
const {parseGatewayStatus} = require('../../library/gateway-status');

// Device-level sensors, in display order. Each is only added once the gateway reports it.
const SENSOR_CAPABILITIES = [
    'connected',
    'alarm_wan_down',
    'measure_uplink_rx',
    'measure_uplink_tx',
    'measure_wan_latency',
    'measure_wan_availability',
    'measure_speedtest_download',
    'measure_speedtest_upload',
    'public_ip',
    'wan_ip',
    'ipAddress',
    'measure_connected_clients',
    'uptime',
    'ports',
    'measure_device_temperature',
    'alarm_overheating',
    'measure_cpu_usage',
    'measure_memory_usage',
    'alarm_firmware_update',
];

// The gateway's uplink is the internet connection
const CAPABILITY_TITLES = {
    measure_uplink_rx: {en: 'Internet download', nl: 'Internet download', de: 'Internet-Download', pt: 'Download da internet'},
    measure_uplink_tx: {en: 'Internet upload', nl: 'Internet upload', de: 'Internet-Upload', pt: 'Upload da internet'},
    ipAddress: {en: 'LAN IP', nl: 'LAN-IP', de: 'LAN-IP', pt: 'IP da LAN'},
};

/**
 * UniFi gateway (Cloud Gateway, Dream Machine, ...). Same behaviour as a
 * switch (ports, flow cards, polling, real-time updates) plus WAN sensors.
 * PoE ports are shown read-only: changing gateway port settings re-provisions
 * the gateway, which can briefly drop the internet connection.
 */
class GatewayDevice extends NetworkSwitchDevice {

    get sensorCapabilities() { return SENSOR_CAPABILITIES; }
    get capabilityLayoutVersion() { return 1; }
    get capabilityTitles() { return CAPABILITY_TITLES; }
    get supportsPoeControl() { return false; }

    parseStatus(data) {
        const status = parseGatewayStatus(data);
        this._checkPublicIp(status.caps.public_ip);
        return status;
    }

    _checkPublicIp(ip) {
        if (!ip) return;
        const previous = this._publicIp;
        this._publicIp = ip;
        if (previous && previous !== ip) {
            this.driver.publicIpChanged.trigger(this, {public_ip: ip, previous_ip: previous}).catch(this.error);
        }
    }
}

module.exports = GatewayDevice;
