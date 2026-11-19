'use strict';

const { HttpError } = require('../Base/errors');
const { UserModel } = require('./user.model');
const { hashPassword } = require('./password');
const { validateNewUser } = require('./user.validation');

class UserService {
    constructor({ userModel }) {
        this.userModel = userModel;
    }

    /**
     * Validates the input, hashes the password and stores a new user.
     * @returns the public user (without the password hash)
     * @throws HttpError 400 when input is invalid, 409 when the email is already taken
     */
    async createUser(input) {
        const { name, email, password, role } = validateNewUser(input);

        if (this.userModel.findByEmail(email)) {
            throw HttpError.conflict('A user with this email already exists');
        }

        const passwordHash = await hashPassword(password);
        try {
            return UserModel.toPublic(this.userModel.create({ name, email, passwordHash, role }));
        } catch (err) {
            // Another request created the same email between the check and the insert.
            if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw HttpError.conflict('A user with this email already exists');
            }
            throw err;
        }
    }
}

module.exports = { UserService };
