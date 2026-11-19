'use strict';

/**
 * An error whose message is safe to send to the client.
 * Any other error becomes a generic 500 response.
 */
class HttpError extends Error {
    constructor(status, message, details) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        if (details !== undefined) {
            this.details = details;
        }
    }

    static badRequest(message = 'Bad request', details) {
        return new HttpError(400, message, details);
    }

    static unauthorized(message = 'Unauthorized') {
        return new HttpError(401, message);
    }

    static notFound(message = 'Not found') {
        return new HttpError(404, message);
    }

    static conflict(message = 'Conflict') {
        return new HttpError(409, message);
    }
}

module.exports = { HttpError };
