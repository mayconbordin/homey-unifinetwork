'use strict';

/**
 * Centralized error handling utilities for API and network errors
 */

/**
 * Check if error is a 401 Unauthorized error
 * @param {Error} error
 * @returns {boolean}
 */
function is401Error(error) {
    if (error.response && error.response.status === 401) {
        return true;
    }
    if (error.message && error.message.includes('401')) {
        return true;
    }
    return false;
}

/**
 * Check if a UniFi OS login was rejected because the account requires MFA
 * (HTTP 499, e.g. email code or authenticator app).
 * @param {Error} error
 * @returns {boolean}
 */
function isMfaRequiredError(error) {
    if (!error) return false;
    const status = (error.response && error.response.status) || error.status;
    if (status === 499) return true;
    const data = error.response && error.response.data;
    const code = data && (data.code || (data.meta && data.meta.msg));
    return typeof code === 'string' && /mfa|2fa/i.test(code);
}

/**
 * Check if error is a timeout error
 * @param {Error} error
 * @returns {boolean}
 */
function isTimeoutError(error) {
    if (error.code === 'ECONNABORTED') {
        return true;
    }
    if (error.message && error.message.includes('timeout')) {
        return true;
    }
    if (error.message && error.message.includes('exceeded')) {
        return true;
    }
    return false;
}

/**
 * Extract a user-friendly error message from an error object
 * @param {Error} error
 * @returns {string}
 */
function getUserFriendlyMessage(error) {
    if (isMfaRequiredError(error)) {
        return 'This UniFi account requires MFA (e.g. an email code). Use a local-only admin account without MFA';
    }
    if (is401Error(error)) {
        return 'Unauthorized: Check your UniFi credentials in the app settings';
    }
    if (isTimeoutError(error)) {
        return 'Connection timeout: Check if your UniFi controller is reachable';
    }
    if (error.message) {
        return error.message;
    }
    return 'An unexpected error occurred';
}

/**
 * Create a standardized error object for handling
 * @param {Error} error
 * @returns {object}
 */
function parseError(error) {
    return {
        isAuthError: is401Error(error),
        isMfaRequired: isMfaRequiredError(error),
        isTimeout: isTimeoutError(error),
        message: getUserFriendlyMessage(error),
        originalError: error,
    };
}

module.exports = {
    is401Error,
    isMfaRequiredError,
    isTimeoutError,
    getUserFriendlyMessage,
    parseError,
};

