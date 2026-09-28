'use strict';

/**
 * An error caused by the user's input or environment (missing archive,
 * unsupported format, ...). The CLI prints it without a stack trace.
 */
class UserError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'UserError';
    this.hint = hint || '';
  }
}

module.exports = { UserError };
