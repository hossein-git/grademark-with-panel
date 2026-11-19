'use strict';

/**
 * Creates a dashboard user from the command line. There is no public sign-up endpoint.
 *
 *   npm run user:create -- --name "Jane Doe" --email jane@example.com [--password "..."] [--role admin|user]
 *
 * If --password is left out, a random password is generated and printed once.
 * Passwords passed with --password can end up in your shell history.
 */

const crypto = require('node:crypto');
const { parseArgs } = require('node:util');
const { loadConfig } = require('../../Base/config');
const { bootstrap } = require('../../Base/bootstrap');
const modules = require('../..');

const USAGE = 'Usage: npm run user:create -- --name "Jane Doe" --email jane@example.com [--password "..."] [--role admin|user]';

async function main(argv = process.argv.slice(2), { env = process.env, out = console } = {}) {
    let values;
    try {
        ({ values } = parseArgs({
            args: argv,
            options: {
                name: { type: 'string' },
                email: { type: 'string' },
                password: { type: 'string' },
                role: { type: 'string', default: 'admin' },
                help: { type: 'boolean', short: 'h' },
            },
        }));
    } catch (err) {
        out.error(`${err.message}\n${USAGE}`);
        return 1;
    }

    if (values.help) {
        out.log(USAGE);
        return 0;
    }

    const generatedPassword = values.password === undefined ? crypto.randomBytes(12).toString('base64url') : null;
    const config = loadConfig(env);
    const { db, context } = bootstrap({ config, modules, logger: out });

    try {
        const user = await context.userService.createUser({
            name: values.name,
            email: values.email,
            password: generatedPassword || values.password,
            role: values.role,
        });
        out.log(`Created ${user.role} user #${user.id}: ${user.name} <${user.email}>`);
        if (generatedPassword) {
            out.log(`Generated password (shown only once): ${generatedPassword}`);
        }
        return 0;
    } catch (err) {
        if (err.status) {
            const details = err.details
                ? Object.entries(err.details).map(([field, msg]) => `  - ${field}: ${msg}`).join('\n')
                : '';
            out.error(`Could not create user: ${err.message}${details ? `\n${details}` : ''}\n${USAGE}`);
            return 1;
        }
        throw err;
    } finally {
        db.close();
    }
}

if (require.main === module) {
    main().then((code) => {
        process.exitCode = code;
    }, (err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

module.exports = { main };
