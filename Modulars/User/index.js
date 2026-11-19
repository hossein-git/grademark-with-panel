'use strict';

const migrations = require('./user.migrations');
const { UserModel } = require('./user.model');
const { SessionModel } = require('./session.model');
const { UserService } = require('./user.service');
const { AuthService } = require('./auth.service');
const { createRequireAuth } = require('./auth.middleware');
const { createAuthRouter } = require('./auth.routes');

/** User module: users, password login, sessions and the `requireAuth` middleware. */
module.exports = {
    name: 'User',

    migrations,

    createServices({ db, config }) {
        const userModel = new UserModel(db);
        const sessionModel = new SessionModel(db);
        const authService = new AuthService({ userModel, sessionModel, authConfig: config.auth });
        return {
            userModel,
            userService: new UserService({ userModel }),
            authService,
            requireAuth: createRequireAuth(authService),
        };
    },

    register(app, context) {
        app.use('/api/auth', createAuthRouter(context));
    },
};
