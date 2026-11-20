'use strict';

const https = require('https');
const { EventEmitter } = require('events');
const UnifiApiKeyController = require('../../library/unifi-apikey-controller');

/** Stub https.request; `responder(opts, body)` returns {status, body}. */
function stubHttps(responder) {
    const calls = [];
    jest.spyOn(https, 'request').mockImplementation((opts, cb) => {
        const req = new EventEmitter();
        let body = '';
        req.write = (chunk) => { body += chunk; };
        req.destroy = (err) => req.emit('error', err);
        req.end = () => {
            calls.push({ opts, body: body ? JSON.parse(body) : null });
            const { status, body: resBody } = responder(opts, body);
            const res = new EventEmitter();
            res.statusCode = status;
            cb(res);
            res.emit('data', Buffer.from(typeof resBody === 'string' ? resBody : JSON.stringify(resBody)));
            res.emit('end');
        };
        return req;
    });
    return calls;
}

describe('UnifiApiKeyController', () => {
    afterEach(() => jest.restoreAllMocks());

    const make = () => new UnifiApiKeyController({ host: '192.168.1.1', site: 'default', apiKey: 'secret' });

    it('sends the X-API-KEY header and unwraps legacy {meta,data}', async () => {
        const calls = stubHttps(() => ({ status: 200, body: { meta: { rc: 'ok' }, data: [{ mac: 'aa' }] } }));
        const result = await make().getClientDevices();
        expect(result).toEqual([{ mac: 'aa' }]);
        expect(calls[0].opts.path).toBe('/proxy/network/api/s/default/stat/sta/');
        expect(calls[0].opts.headers['X-API-KEY']).toBe('secret');
        expect(calls[0].opts.rejectUnauthorized).toBe(false);
    });

    it('rejects with a 401-tagged error on auth failure', async () => {
        stubHttps(() => ({ status: 401, body: { error: { code: 401, message: 'Unauthorized' } } }));
        const err = await make().getAccessDevices().catch(e => e);
        expect(err.message).toContain('401');
        expect(err.response.status).toBe(401);
    });

    it('rejects when the legacy envelope reports an error', async () => {
        stubHttps(() => ({ status: 200, body: { meta: { rc: 'error', msg: 'api.err.Invalid' }, data: [] } }));
        await expect(make().blockClient('AA:BB')).rejects.toThrow('api.err.Invalid');
    });

    it('sends block-sta with a lower-cased MAC', async () => {
        const calls = stubHttps(() => ({ status: 200, body: { meta: { rc: 'ok' }, data: [] } }));
        await make().blockClient('AA:BB:CC:DD:EE:FF');
        expect(calls[0].opts.method).toBe('POST');
        expect(calls[0].body).toEqual({ cmd: 'block-sta', mac: 'aa:bb:cc:dd:ee:ff' });
    });

    it('resolves the integration site UUID and device UUID by MAC', async () => {
        stubHttps((opts) => {
            if (opts.path.startsWith('/proxy/network/integration/v1/sites?')) {
                return { status: 200, body: { totalCount: 1, data: [{ id: 'site-uuid', internalReference: 'default' }] } };
            }
            return { status: 200, body: { totalCount: 1, data: [{ id: 'dev-uuid', macAddress: 'aa:bb:cc:dd:ee:ff' }] } };
        });
        await expect(make().getIntegrationDeviceId('AA:BB:CC:DD:EE:FF'))
            .resolves.toEqual({ siteId: 'site-uuid', deviceId: 'dev-uuid' });
    });

    it('login() fails when the configured site does not exist', async () => {
        stubHttps((opts) => opts.path.endsWith('/info')
            ? { status: 200, body: { applicationVersion: '11.0.99' } }
            : { status: 200, body: { meta: { rc: 'ok' }, data: [{ name: 'other' }] } });
        await expect(make().login()).rejects.toThrow('Site "default" not found');
    });
});
