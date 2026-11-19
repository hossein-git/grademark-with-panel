'use strict';

const path = require('node:path');
const { PROJECT_ROOT } = require('../Base/config');

/**
 * Loads the Grademark engine compiled from src/ (`npm run build` writes it to build/).
 * `npm start`, `npm run dev` and `npm run test:backend` build it automatically.
 */
function loadEngine() {
    const buildPath = path.join(PROJECT_ROOT, 'build', 'index.js');
    try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        return require(buildPath);
    } catch (err) {
        if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(buildPath)) {
            throw new Error('The Grademark engine is not built yet. Run "npm run build" in the project root first.');
        }
        throw err;
    }
}

module.exports = { loadEngine };
