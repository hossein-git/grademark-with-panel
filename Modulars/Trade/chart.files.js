'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dataForge = require('data-forge');

// MetaTrader timeframe codes: M1..M30 (minutes), H1..H12 (hours), D1, W1, MN1 (month).
const TIMEFRAME_PATTERN = /^(M([1-9]|[1-5]\d)|H([1-9]|1[0-2])|D1|W1|MN1?)$/;
const CHART_FILE_PATTERN = /^([A-Za-z0-9.#&-]+)_([A-Za-z0-9]+)\.csv$/i;

/** Length of a timeframe in minutes. Used to sort timeframes from short to long. */
function timeframeMinutes(timeframe) {
    const match = /^(M|H|D|W|MN)(\d*)$/.exec(timeframe);
    if (!match) return Number.MAX_SAFE_INTEGER;
    const unit = { M: 1, H: 60, D: 1440, W: 10080, MN: 43200 }[match[1]];
    return unit * Number(match[2] || 1);
}

/**
 * Parses a chart file name like "EURUSD_H4.csv".
 * @returns { name: 'EURUSD_H4', symbol: 'EURUSD', timeframe: 'H4' } or null if the name does not fit the pattern
 */
function parseChartFileName(fileName) {
    const match = CHART_FILE_PATTERN.exec(fileName);
    if (!match) return null;
    const symbol = match[1].toUpperCase();
    const timeframe = match[2].toUpperCase();
    if (!TIMEFRAME_PATTERN.test(timeframe)) return null;
    return { name: `${symbol}_${timeframe}`, symbol, timeframe, fileName };
}

/** Lists the valid chart files in `dir`. Files with other names are returned in `skipped`. */
function listChartFiles(dir) {
    const charts = [];
    const skipped = [];
    if (!fs.existsSync(dir)) return { charts, skipped };

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.csv')) continue;
        const parsed = parseChartFileName(entry.name);
        if (parsed) charts.push(parsed);
        else skipped.push(entry.name);
    }
    charts.sort((a, b) => a.name.localeCompare(b.name));
    return { charts, skipped };
}

// "2026.01.02" or "2026-01-02", optionally followed by a time "14:30" / "14:30:00" (space or T separated).
const DATE_TIME_PATTERN = /^(\d{4})[.-](\d{2})[.-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function parseUtcDate(text, lineNumber) {
    const match = DATE_TIME_PATTERN.exec(text.trim());
    if (!match) {
        throw new Error(`Line ${lineNumber}: unsupported date "${text}" (expected YYYY.MM.DD or YYYY-MM-DD, optional HH:MM[:SS])`);
    }
    const [, y, mo, d, h = '0', mi = '0', s = '0'] = match;
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    if (date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d) {
        throw new Error(`Line ${lineNumber}: invalid date "${text}"`);
    }
    return date;
}

/**
 * Reads a chart CSV into an array of bars: { time: Date, open, high, low, close, ...other numeric columns }.
 *
 * Supports MetaTrader 5 exports (tab-separated, columns <DATE> [<TIME>] <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD>)
 * and plain CSVs with date/time/open/high/low/close headers. Times are treated as UTC
 * (MetaTrader writes broker server time with no timezone). The result is sorted oldest first.
 */
function readChartBars(filePath) {
    const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);
    const headerLine = lines[0] || '';
    const separator = headerLine.includes('\t') ? '\t' : headerLine.includes(';') ? ';' : ',';
    const headers = headerLine.split(separator).map((h) => h.trim().replace(/^<|>$/g, '').toLowerCase());

    const dateIndex = headers.indexOf('date');
    const timeIndex = headers.indexOf('time');
    if (dateIndex === -1 && timeIndex === -1) {
        throw new Error(`${path.basename(filePath)}: missing a DATE or TIME column`);
    }
    for (const required of ['open', 'high', 'low', 'close']) {
        if (!headers.includes(required)) {
            throw new Error(`${path.basename(filePath)}: missing required column "${required}"`);
        }
    }

    const valueColumns = headers
        .map((name, index) => ({ name, index }))
        .filter(({ name, index }) => name && index !== dateIndex && index !== timeIndex);

    const bars = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const cells = line.split(separator);
        const lineNumber = i + 1;

        const dateText = dateIndex !== -1
            ? (timeIndex !== -1 ? `${cells[dateIndex]} ${cells[timeIndex]}` : cells[dateIndex])
            : cells[timeIndex];
        const bar = { time: parseUtcDate(dateText || '', lineNumber) };

        for (const { name, index } of valueColumns) {
            const value = Number(cells[index]);
            if (cells[index] === undefined || cells[index].trim() === '' || !Number.isFinite(value)) {
                throw new Error(`${path.basename(filePath)} line ${lineNumber}: invalid number in column "${name}"`);
            }
            bar[name] = value;
        }
        bars.push(bar);
    }

    for (let i = 1; i < bars.length; i++) {
        if (bars[i].time < bars[i - 1].time) {
            bars.sort((a, b) => a.time - b.time);
            break;
        }
    }
    return bars;
}

/** Loads a chart CSV as a Data-Forge DataFrame, which is what the Grademark engine expects. */
function loadChartDataFrame(filePath) {
    return new dataForge.DataFrame(readChartBars(filePath));
}

module.exports = { parseChartFileName, listChartFiles, readChartBars, loadChartDataFrame, timeframeMinutes };
