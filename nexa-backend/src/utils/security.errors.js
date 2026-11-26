/**
 * SecurityError represents security, authentication, or protocol violations
 * with explicit HTTP status codes.
 */
export class SecurityError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'SecurityError';
    this.statusCode = statusCode;
  }
}

export default SecurityError;
