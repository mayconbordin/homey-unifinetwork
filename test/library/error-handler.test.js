'use strict';

const ErrorHandler = require('../../library/error-handler');

describe('ErrorHandler.isMfaRequiredError', () => {
    it('detects HTTP 499 from UniFi OS login', () => {
        const err = new Error('Request failed with status code 499');
        err.response = { status: 499, data: {} };
        expect(ErrorHandler.isMfaRequiredError(err)).toBe(true);
        expect(ErrorHandler.parseError(err).isMfaRequired).toBe(true);
        expect(ErrorHandler.getUserFriendlyMessage(err)).toMatch(/MFA/);
    });

    it('detects an MFA error code in the response body', () => {
        const err = new Error('login failed');
        err.response = { status: 401, data: { code: 'MFA_AUTH_REQUIRED' } };
        expect(ErrorHandler.isMfaRequiredError(err)).toBe(true);
    });

    it('does not flag ordinary auth failures', () => {
        const err = new Error('Request failed with status code 401');
        err.response = { status: 401, data: { code: 'AUTHENTICATION_FAILED_INVALID_CREDENTIALS' } };
        expect(ErrorHandler.isMfaRequiredError(err)).toBe(false);
        expect(ErrorHandler.parseError(err).isAuthError).toBe(true);
    });
});
