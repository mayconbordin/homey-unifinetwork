'use strict';

const {toMbps, toNumber} = require('./switch-status');

// UniFi radio type → band key used in capability ids
const RADIO_BANDS = {ng: '2g', na: '5g', '6e': '6g', '6g': '6g'};
const BAND_LABELS = {'2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz'};
const BAND_ORDER = ['2g', '5g', '6g'];

/**
 * Maps a UniFi access point object (classic `stat/device` entry or a
 * `device:sync` payload) to the extra Homey capability values for APs.
 * Values the AP does not report are left out.
 *
 * Per-band values use sub-capabilities, e.g. `measure_connected_clients.5g`.
 */
function parseAccessPointStatus(device) {
    const caps = {};
    const set = (cap, value) => {
        if (value !== null && typeof value !== 'undefined') caps[cap] = value;
    };

    const systemStats = device['system-stats'] || {};
    set('measure_cpu_usage', toNumber(systemStats.cpu));
    set('measure_memory_usage', toNumber(systemStats.mem));

    if (device.uplink) {
        set('measure_uplink_rx', toMbps(device.uplink['rx_bytes-r']));
        set('measure_uplink_tx', toMbps(device.uplink['tx_bytes-r']));
    }

    // UniFi reports -1 when there is not enough data for a score
    const experience = toNumber(device.satisfaction);
    if (experience !== null && experience >= 0) set('measure_wifi_experience', experience);

    const bands = [];
    const radios = Array.isArray(device.radio_table_stats) ? device.radio_table_stats : [];
    for (const radio of radios) {
        const band = RADIO_BANDS[radio.radio];
        if (!band || bands.includes(band)) continue;
        bands.push(band);
        set(`measure_connected_clients.${band}`, toNumber(radio.num_sta));
        set(`measure_channel_utilization.${band}`, toNumber(radio.cu_total));
    }
    bands.sort((a, b) => BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b));

    return {caps, bands};
}

module.exports = {parseAccessPointStatus, BAND_LABELS};
