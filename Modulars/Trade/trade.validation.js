'use strict';

const { HttpError } = require('../Base/errors');

const DEFAULT_STARTING_CAPITAL = 10000;
const MAX_STARTING_CAPITAL = 1e12;

function fail(errors) {
    throw HttpError.badRequest('Validation failed', errors);
}

function isPositiveInt(value) {
    return Number.isInteger(value) && value > 0;
}

/** Parses a positive integer route parameter such as ":id". Throws 404 if it is not one. */
function parseId(raw, label = 'Resource') {
    const id = Number(raw);
    if (!/^\d+$/.test(String(raw)) || !isPositiveInt(id)) {
        throw HttpError.notFound(`${label} not found`);
    }
    return id;
}

/** Body of POST /backtests: { strategyId, chartId, startingCapital? } */
function validateStartBacktest(input) {
    const data = input && typeof input === 'object' ? input : {};
    const errors = {};

    if (!isPositiveInt(data.strategyId)) errors.strategyId = 'strategyId must be a positive integer';
    if (!isPositiveInt(data.chartId)) errors.chartId = 'chartId must be a positive integer';

    let startingCapital = DEFAULT_STARTING_CAPITAL;
    if (data.startingCapital !== undefined && data.startingCapital !== null) {
        startingCapital = data.startingCapital;
        if (typeof startingCapital !== 'number' || !Number.isFinite(startingCapital)
            || startingCapital <= 0 || startingCapital > MAX_STARTING_CAPITAL) {
            errors.startingCapital = `startingCapital must be a number greater than 0 and at most ${MAX_STARTING_CAPITAL}`;
        }
    }

    if (Object.keys(errors).length > 0) fail(errors);
    return { strategyId: data.strategyId, chartId: data.chartId, startingCapital };
}

/** Body of PATCH /strategies/:id and /charts/:id: { isActive } */
function validateSetActive(input) {
    const data = input && typeof input === 'object' ? input : {};
    if (typeof data.isActive !== 'boolean') fail({ isActive: 'isActive must be a boolean' });
    return { isActive: data.isActive };
}

/** Query of GET /strategies/:id/backtests: ?symbol=EURUSD&timeframe=H4 (both optional). */
function validateBacktestFilters(query) {
    const errors = {};
    const result = {};
    for (const [name, pattern] of [['symbol', /^[A-Za-z0-9.#&-]{1,32}$/], ['timeframe', /^[A-Za-z0-9]{1,4}$/]]) {
        const value = query[name];
        if (value === undefined || value === '') continue;
        if (typeof value !== 'string' || !pattern.test(value)) {
            errors[name] = `Invalid ${name}`;
        } else {
            result[name] = value.toUpperCase();
        }
    }
    if (Object.keys(errors).length > 0) fail(errors);
    return result;
}

const MAX_ITERATIONS = 10000;
const MAX_SAMPLES = 10000;
const MAX_SEED = 2 ** 31 - 1;

/** Body of POST /backtests/:id/monte-carlo: { numIterations?, numSamples?, randomSeed? } (all optional). */
function validateStartMonteCarlo(input) {
    const data = input && typeof input === 'object' ? input : {};
    const errors = {};
    const result = {};
    const intInRange = (name, min, max) => {
        const value = data[name];
        if (value === undefined || value === null) return;
        if (!Number.isInteger(value) || value < min || value > max) {
            errors[name] = `${name} must be an integer between ${min} and ${max}`;
        } else {
            result[name] = value;
        }
    };
    intInRange('numIterations', 1, MAX_ITERATIONS);
    intInRange('numSamples', 1, MAX_SAMPLES);
    intInRange('randomSeed', 0, MAX_SEED);
    if (Object.keys(errors).length > 0) fail(errors);
    return result;
}

module.exports = {
    parseId,
    validateStartBacktest,
    validateSetActive,
    validateBacktestFilters,
    validateStartMonteCarlo,
    DEFAULT_STARTING_CAPITAL,
    MAX_ITERATIONS,
    MAX_SAMPLES,
};
