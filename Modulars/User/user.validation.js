'use strict';

const { HttpError } = require('../Base/errors');

const ROLES = Object.freeze(['admin', 'user']);
const NAME_MAX = 100;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
// Limits the work the login endpoint does on very long inputs.
const LOGIN_PASSWORD_MAX = 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : email;
}

function fail(errors) {
    throw HttpError.badRequest('Validation failed', errors);
}

/**
 * Validates and normalizes the input for creating a user.
 * Throws HttpError(400) with per-field messages when invalid.
 */
function validateNewUser(input) {
    const data = input && typeof input === 'object' ? input : {};
    const errors = {};

    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) {
        errors.name = 'Name is required';
    } else if (name.length > NAME_MAX) {
        errors.name = `Name must be at most ${NAME_MAX} characters`;
    }

    const email = normalizeEmail(data.email);
    if (typeof email !== 'string' || !email) {
        errors.email = 'Email is required';
    } else if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
        errors.email = 'Email must be a valid email address';
    }

    const password = data.password;
    if (typeof password !== 'string' || password.length === 0) {
        errors.password = 'Password is required';
    } else if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
        errors.password = `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters`;
    }

    const role = data.role === undefined ? 'user' : data.role;
    if (!ROLES.includes(role)) {
        errors.role = `Role must be one of: ${ROLES.join(', ')}`;
    }

    if (Object.keys(errors).length > 0) {
        fail(errors);
    }
    return { name, email, password, role };
}

/** Validates the login request body. Throws HttpError(400) when invalid. */
function validateLogin(input) {
    const data = input && typeof input === 'object' ? input : {};
    const errors = {};

    const email = normalizeEmail(data.email);
    if (typeof email !== 'string' || !email) {
        errors.email = 'Email is required';
    } else if (email.length > EMAIL_MAX) {
        errors.email = 'Email is too long';
    }

    if (typeof data.password !== 'string' || data.password.length === 0) {
        errors.password = 'Password is required';
    } else if (data.password.length > LOGIN_PASSWORD_MAX) {
        errors.password = 'Password is too long';
    }

    if (data.remember !== undefined && typeof data.remember !== 'boolean') {
        errors.remember = 'Remember must be a boolean';
    }

    if (Object.keys(errors).length > 0) {
        fail(errors);
    }
    return { email, password: data.password, remember: data.remember === true };
}

module.exports = { validateNewUser, validateLogin, normalizeEmail, ROLES, PASSWORD_MIN, PASSWORD_MAX };
