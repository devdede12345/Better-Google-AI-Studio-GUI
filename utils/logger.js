/**
 * AetherMind Debug Logger
 * Ring-buffer logger that retains the last MAX_ENTRIES log entries.
 * Each entry: { ts, module, level, msg }
 * Accessible globally via window.__aetherLog (for snapshot export).
 */
(function () {
  'use strict';

  var MAX_ENTRIES = 100;
  var buffer = [];

  function now() {
    return new Date().toISOString();
  }

  function push(level, module, msg) {
    var entry = { ts: now(), module: module, level: level, msg: msg };
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) buffer.shift();
    // Also forward to native console
    var fn = level === 'error' ? console.error
           : level === 'warn'  ? console.warn
           : console.log;
    fn('[' + module + '] ' + msg);
  }

  var Logger = {
    info:  function (module, msg) { push('info',  module, msg); },
    warn:  function (module, msg) { push('warn',  module, msg); },
    error: function (module, msg) { push('error', module, msg); },

    /** Return a copy of the buffer (newest last). */
    getAll: function () { return buffer.slice(); },

    /** Return only entries with level 'error' or 'warn'. */
    getErrors: function () {
      return buffer.filter(function (e) {
        return e.level === 'error' || e.level === 'warn';
      });
    },

    /** Clear the buffer. */
    clear: function () { buffer.length = 0; },
  };

  // Expose for both ISOLATED and MAIN world scripts
  window.__aetherLog = Logger;
})();
