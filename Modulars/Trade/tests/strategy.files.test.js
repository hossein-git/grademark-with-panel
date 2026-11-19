'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listStrategyFiles, loadStrategyDefinition } = require('../strategy.files');
const { FIXTURE_STRATEGIES } = require('./helpers');

describe('Trade/strategy files', () => {
    let dir;
    const write = (name, content) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, content);
        return file;
    };

    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-strategies-'));
    });
    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('lists .js files as strategies keyed by file name', () => {
        const files = listStrategyFiles(FIXTURE_STRATEGIES);
        assert.deepEqual(files.map((f) => f.key), ['Broken', 'HoldThreeBars', 'NeverFinishes', 'ThrowsOnRun']);
        assert.equal(files[1].fileName, 'HoldThreeBars.js');
        assert.equal(files[1].filePath, path.join(FIXTURE_STRATEGIES, 'HoldThreeBars.js'));
        assert.deepEqual(listStrategyFiles('/definitely/not/here'), []);
    });

    it('ignores non-.js files and unsafe names', () => {
        write('Good.js', "module.exports = { strategy: { entryRule() {} } };");
        write('README.md', '# notes');
        write('bad name.js', "module.exports = {};");
        assert.deepEqual(listStrategyFiles(dir).map((f) => f.key), ['Good']);
    });

    it('loads name, description and strategy', () => {
        const definition = loadStrategyDefinition(path.join(FIXTURE_STRATEGIES, 'HoldThreeBars.js'));
        assert.equal(definition.name, 'Hold three bars');
        assert.match(definition.description, /three bars/);
        assert.equal(typeof definition.strategy.entryRule, 'function');
    });

    it('uses the file name when no name is given', () => {
        const file = write('NoName.js', "module.exports = { strategy: { entryRule() {} } };");
        assert.deepEqual(loadStrategyDefinition(file).name, 'NoName');
        assert.equal(loadStrategyDefinition(file).description, null);
    });

    it('reports what is wrong with an invalid strategy file', () => {
        const cases = [
            ['NotObject.js', 'module.exports = 42;', /must export an object/],
            ['NoStrategy.js', "module.exports = { name: 'x' };", /Missing "strategy" object/],
            ['NoEntry.js', 'module.exports = { strategy: {} };', /"strategy.entryRule" must be a function/],
            ['BadExit.js', 'module.exports = { strategy: { entryRule() {}, exitRule: 5 } };', /"strategy.exitRule" must be a function/],
            ['BadName.js', "module.exports = { name: '  ', strategy: { entryRule() {} } };", /"name" must be a non-empty string/],
            ['BadDesc.js', 'module.exports = { description: 1, strategy: { entryRule() {} } };', /"description" must be a string/],
            ['Syntax.js', 'module.exports = {', /Unexpected end of input/],
        ];
        for (const [name, content, expected] of cases) {
            assert.throws(() => loadStrategyDefinition(write(name, content)), expected, name);
        }
        assert.throws(() => loadStrategyDefinition(path.join(FIXTURE_STRATEGIES, 'Broken.js')), /Missing "strategy" object/);
    });

    it('re-reads the file so edits are picked up without a restart', () => {
        const file = write('Edited.js', "module.exports = { name: 'Version 1', strategy: { entryRule() {} } };");
        assert.equal(loadStrategyDefinition(file).name, 'Version 1');
        fs.writeFileSync(file, "module.exports = { name: 'Version 2', strategy: { entryRule() {} } };");
        assert.equal(loadStrategyDefinition(file).name, 'Version 2');
    });
});
