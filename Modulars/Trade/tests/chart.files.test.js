'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseChartFileName, listChartFiles, readChartBars, loadChartDataFrame, timeframeMinutes } = require('../chart.files');
const { FIXTURE_CHARTS } = require('./helpers');

describe('Trade/chart files', () => {
    describe('parseChartFileName', () => {
        it('splits SYMBOL_TIMEFRAME.csv and normalizes to upper case', () => {
            assert.deepEqual(parseChartFileName('EURUSD_H4.csv'), { name: 'EURUSD_H4', symbol: 'EURUSD', timeframe: 'H4', fileName: 'EURUSD_H4.csv' });
            assert.deepEqual(parseChartFileName('gbpusd_m15.CSV'), { name: 'GBPUSD_M15', symbol: 'GBPUSD', timeframe: 'M15', fileName: 'gbpusd_m15.CSV' });
            assert.equal(parseChartFileName('US30.cash_D1.csv').symbol, 'US30.CASH');
        });

        it('accepts the MetaTrader timeframes', () => {
            for (const tf of ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'H12', 'D1', 'W1', 'MN1']) {
                assert.equal(parseChartFileName(`EURUSD_${tf}.csv`).timeframe, tf);
            }
        });

        it('rejects names that do not fit the pattern', () => {
            for (const name of ['EURUSD.csv', 'EURUSD_D1.txt', 'EURUSD_X9.csv', 'EURUSD_M61.csv', 'EURUSD_H13.csv', 'EUR USD_D1.csv', '_D1.csv', 'notes.csv']) {
                assert.equal(parseChartFileName(name), null, name);
            }
        });
    });

    it('timeframeMinutes orders timeframes from shortest to longest', () => {
        const sorted = ['D1', 'MN1', 'M15', 'H4', 'W1', 'M1', 'H1'].sort((a, b) => timeframeMinutes(a) - timeframeMinutes(b));
        assert.deepEqual(sorted, ['M1', 'M15', 'H1', 'H4', 'D1', 'W1', 'MN1']);
    });

    it('listChartFiles returns valid charts sorted by name and reports skipped files', () => {
        const { charts, skipped } = listChartFiles(FIXTURE_CHARTS);
        assert.deepEqual(charts.map((c) => c.name), ['OTHER_M15', 'TEST_D1', 'TEST_H4']);
        assert.deepEqual(skipped, ['notes.csv']);
        assert.deepEqual(listChartFiles('/definitely/not/here'), { charts: [], skipped: [] });
    });

    describe('readChartBars', () => {
        it('reads a MetaTrader daily export (tabs, CRLF, <DATE>) as UTC bars', () => {
            const bars = readChartBars(path.join(FIXTURE_CHARTS, 'TEST_D1.csv'));
            assert.equal(bars.length, 40);
            assert.deepEqual(bars[0], {
                time: new Date('2024-01-01T00:00:00.000Z'),
                open: 100, high: 100.75, low: 99.75, close: 100.5, tickvol: 1000, vol: 0, spread: 2,
            });
        });

        it('combines <DATE> and <TIME> columns for intraday exports', () => {
            const bars = readChartBars(path.join(FIXTURE_CHARTS, 'TEST_H4.csv'));
            assert.equal(bars.length, 30);
            assert.equal(bars[1].time.toISOString(), '2024-03-01T04:00:00.000Z');
            assert.equal(bars[29].time.toISOString(), '2024-03-05T20:00:00.000Z');
        });

        it('reads comma-separated files with ISO timestamps', () => {
            const bars = readChartBars(path.join(FIXTURE_CHARTS, 'OTHER_M15.csv'));
            assert.equal(bars.length, 30);
            assert.equal(bars[2].time.toISOString(), '2024-05-06T09:30:00.000Z');
            assert.deepEqual(Object.keys(bars[0]), ['time', 'open', 'high', 'low', 'close']);
        });

        it('reads the real EURUSD_D1 chart from the project', () => {
            const bars = readChartBars(path.join(__dirname, '..', '..', '..', 'Charts', 'EURUSD_D1.csv'));
            assert.equal(bars.length, 226);
            assert.equal(bars[0].time.toISOString(), '2026-01-02T00:00:00.000Z');
        });

        describe('edge cases', () => {
            let dir;
            const write = (name, content) => {
                const file = path.join(dir, name);
                fs.writeFileSync(file, content);
                return file;
            };

            before(() => {
                dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-charts-'));
            });
            after(() => fs.rmSync(dir, { recursive: true, force: true }));

            it('sorts bars that are out of order and strips a UTF-8 BOM', () => {
                const file = write('A_D1.csv', '\uFEFFdate,open,high,low,close\n2024-01-03,3,3,3,3\n2024-01-01,1,1,1,1\n2024-01-02,2,2,2,2\n\n');
                assert.deepEqual(readChartBars(file).map((b) => b.close), [1, 2, 3]);
            });

            it('fails with the line number for a bad number or date', () => {
                const badNumber = write('B_D1.csv', 'date,open,high,low,close\n2024-01-01,1,1,1,1\n2024-01-02,1,abc,1,1\n');
                assert.throws(() => readChartBars(badNumber), /line 3: invalid number in column "high"/);
                const missingValue = write('C_D1.csv', 'date,open,high,low,close\n2024-01-01,1,1,1\n');
                assert.throws(() => readChartBars(missingValue), /line 2: invalid number in column "close"/);
                const badDate = write('D_D1.csv', 'date,open,high,low,close\n01/02/2024,1,1,1,1\n');
                assert.throws(() => readChartBars(badDate), /Line 2: unsupported date "01\/02\/2024"/);
                const impossibleDate = write('E_D1.csv', 'date,open,high,low,close\n2024-02-30,1,1,1,1\n');
                assert.throws(() => readChartBars(impossibleDate), /invalid date "2024-02-30"/);
            });

            it('fails when required columns are missing', () => {
                assert.throws(() => readChartBars(write('F_D1.csv', 'open,high,low,close\n1,1,1,1\n')), /missing a DATE or TIME column/);
                assert.throws(() => readChartBars(write('G_D1.csv', 'date,open,high,close\n2024-01-01,1,1,1\n')), /missing required column "low"/);
            });

            it('loadChartDataFrame returns a Data-Forge DataFrame', () => {
                const df = loadChartDataFrame(path.join(FIXTURE_CHARTS, 'TEST_D1.csv'));
                assert.equal(df.count(), 40);
                assert.equal(df.last().close, 100.5);
            });
        });
    });
});
