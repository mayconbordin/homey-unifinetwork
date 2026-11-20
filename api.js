const ApiClient = require("./library/apiclient");
const ErrorHandler = require("./library/error-handler");
module.exports = {
    async getSites({homey, query}) {
        const result = await homey.app.api.getSites();
        return result;
    },
    async getStatus({ homey, query }) {
        return (homey.app.loggedIn ? 'Connected' : 'Disconnected');
    },
    async getWebsocketStatus({ homey, query }) {
        if (!homey.app.api.websocket) {
            return homey.app.websocketDisabledReason || 'Disabled';
        }
        return (await homey.app.api.websocket.isWebsocketConnected()) ? 'Connected' : 'Unknown';
    },
    async getLastWebsocketMessageTime({ homey, query }) {
        if (!homey.app.api.websocket) {
            return 'N/A';
        }
        return homey.app.api.websocket.getLastWebsocketMessageTime();
    },
    async testCredentials({homey, body}) {
        try {
            const api = new ApiClient({homey});
            const apiKey = body.apiKey ? String(body.apiKey).trim() : null;
            api.setUnifiObject(body.host, body.port, body.user, body.pass, body.site, body.sslverify === true, apiKey);
            await api.login(body.user, body.pass);
            await api.unifi.getAccessDevices();
            await api.unifi.getClientDevices();
            await api.unifi.getAllUsers();
            // With an API key, username/password are only used for real-time events — verify them too
            if (apiKey && body.user && body.pass) {
                await api.getWebsocketSession(body.host, body.port, body.user, body.pass, body.site, body.sslverify === true);
            }
            await api.logout();

            return {
                status: 'success',
            };
        } catch (error) {
            const message = ErrorHandler.getUserFriendlyMessage(error);
            homey.app.error('testCredentials error', message);
            return {
                status: 'failure',
                error: message,
            };
        }
    }
};
