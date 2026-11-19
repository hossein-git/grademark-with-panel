'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STRATEGY_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Lists the strategy files in `dir` as [{ key, fileName, filePath }]. The key is the file name without ".js". */
function listStrategyFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
        .map((entry) => ({ key: entry.name.slice(0, -3), fileName: entry.name, filePath: path.join(dir, entry.name) }))
        .filter(({ key }) => STRATEGY_KEY_PATTERN.test(key))
        .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Loads and checks a strategy file.
 * The file is re-read from disk every time (require cache cleared), so edits are picked up.
 *
 * @returns { name, description, strategy }
 * @throws Error with a readable message if the file cannot be loaded or has the wrong shape
 */
function loadStrategyDefinition(filePath) {
    const resolved = require.resolve(filePath);
    delete require.cache[resolved];
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const definition = require(resolved);

    const key = path.basename(filePath, '.js');
    if (!definition || typeof definition !== 'object') {
        throw new Error('The file must export an object: module.exports = { name, description, strategy }');
    }
    const { strategy } = definition;
    if (!strategy || typeof strategy !== 'object') {
        throw new Error('Missing "strategy" object (a Grademark IStrategy)');
    }
    if (typeof strategy.entryRule !== 'function') {
        throw new Error('"strategy.entryRule" must be a function');
    }
    for (const fn of ['exitRule', 'stopLoss', 'trailingStopLoss', 'profitTarget', 'prepIndicators']) {
        if (strategy[fn] !== undefined && typeof strategy[fn] !== 'function') {
            throw new Error(`"strategy.${fn}" must be a function when provided`);
        }
    }
    if (definition.name !== undefined && (typeof definition.name !== 'string' || !definition.name.trim())) {
        throw new Error('"name" must be a non-empty string when provided');
    }
    if (definition.description !== undefined && typeof definition.description !== 'string') {
        throw new Error('"description" must be a string when provided');
    }

    return {
        name: definition.name ? definition.name.trim() : key,
        description: definition.description || null,
        strategy,
    };
}

module.exports = { listStrategyFiles, loadStrategyDefinition };
