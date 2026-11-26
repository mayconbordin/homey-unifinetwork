'use strict';

const {Driver} = require('homey');
const UnifiConstants = require("../../library/constants");
const Homey = require("homey");
const ErrorHandler = require("../../library/error-handler");

class NetworkSwitch extends Driver {

    /**
     * onInit is called when the driver is initialized.
     */
    // Overridden by the gateway driver, which reuses this class
    get flowPrefix() { return 'network_switch'; }
    async listUnifiDevices() { return this.homey.app.api.getNetworkSwitches(); }

    async onInit() {
        this._initFlowCards();
        this.log(`${this.constructor.name} has been initialized`);
    }

    _initFlowCards() {
        const portAutocomplete = (includeAny) => async (query, args) => {
            const ports = args.device ? args.device.getPorts() : [];
            const items = ports.map(port => ({id: port.idx, name: port.name}));
            if (includeAny) items.unshift({id: 0, name: this.homey.__('flow.any_port')});
            const q = (query || '').toLowerCase();
            return items.filter(item => item.name.toLowerCase().includes(q));
        };
        const id = name => `${this.flowPrefix}_${name}`;
        const portMatches = (args, state) => args.port && (args.port.id === 0 || args.port.id === state.port);

        this.portLinkUp = this.homey.flow.getDeviceTriggerCard(id('port_link_up'));
        this.portLinkDown = this.homey.flow.getDeviceTriggerCard(id('port_link_down'));
        this.portSpeedChanged = this.homey.flow.getDeviceTriggerCard(id('port_speed_changed'));
        for (const card of [this.portLinkUp, this.portLinkDown, this.portSpeedChanged]) {
            card.registerArgumentAutocompleteListener('port', portAutocomplete(true));
            card.registerRunListener(async (args, state) => portMatches(args, state));
        }
        this.firmwareUpdateAvailable = this.homey.flow.getDeviceTriggerCard(id('firmware_update_available'));

        const portIsUp = this.homey.flow.getConditionCard(id('port_is_up'));
        portIsUp.registerArgumentAutocompleteListener('port', portAutocomplete(false));
        portIsUp.registerRunListener(async (args) => {
            const port = args.device.getPort(args.port.id);
            if (!port) throw new Error(`Port ${args.port.name} not found`);
            return port.up;
        });

        const poeAbove = this.homey.flow.getConditionCard(id('port_poe_above'));
        poeAbove.registerArgumentAutocompleteListener('port', portAutocomplete(false));
        poeAbove.registerRunListener(async (args) => {
            const port = args.device.getPort(args.port.id);
            if (!port) throw new Error(`Port ${args.port.name} not found`);
            return port.poePower > args.watts;
        });

        this.homey.flow.getActionCard(id('restart')).registerRunListener(async (args) => {
            await this._runAction(id('restart'), () => this.homey.app.api.restartDevice(args.device.getData().id));
        });

        this.homey.flow.getActionCard(id('locate')).registerRunListener(async (args) => {
            await this._runAction(id('locate'), () => this.homey.app.api.setDeviceLocate(args.device.getData().id, args.state === 'on'));
        });
    }

    async _runAction(name, fn) {
        try {
            await fn();
        } catch (error) {
            const parsed = ErrorHandler.parseError(error);
            this.homey.app.error(`[${name}] ${parsed.message}`);
            if (parsed.isAuthError) {
                await this.homey.app._appLogin();
            }
            throw new Error(parsed.message);
        }
    }

    /**
     * onPairListDevices is called when a user is adding a device
     * and the 'list_devices' view is called.
     * This should return an array with the data of devices that are available for pairing.
     */
    async onPairListDevices() {
        const noControllerConnectionError = this.homey.__('pair.errors.no_controller_connection');
        if (!this.homey.app.loggedIn || !this.homey.app.api || !this.homey.app.api.unifi) {
            throw new Error(noControllerConnectionError);
        }

        try {
            return Object.values(await this.listUnifiDevices()).map(device => {
                let deviceName = this.homey.app.api.getDeviceName(device);

                return {
                    data: {id: String(device.mac)},
                    name: deviceName,
                };
            });
        } catch (error) {
            this.homey.app.error(`[${this.id}][pair] ${error.message || error}`);
            throw new Error(noControllerConnectionError);
        }
    }

    getUnifiDeviceById(deviceId) {
        try {
            const devices = this.getDevices();
            const device = devices.find(device => String(device.getData().id) === String(deviceId));
            if (!device) return false;
            return device;
        } catch (Error) {
            return false;
        }
    }
}

module.exports = NetworkSwitch;
