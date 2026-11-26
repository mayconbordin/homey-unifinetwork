'use strict';

const NetworkSwitch = require('../network-switch/driver');

class Gateway extends NetworkSwitch {

    get flowPrefix() { return 'gateway'; }

    async listUnifiDevices() { return this.homey.app.api.getGateways(); }

    _initFlowCards() {
        super._initFlowCards();
        this.publicIpChanged = this.homey.flow.getDeviceTriggerCard('gateway_public_ip_changed');
    }
}

module.exports = Gateway;
