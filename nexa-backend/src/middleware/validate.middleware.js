import { ZodError } from 'zod';

/**
 * Creates Express middleware to validate request body against a Zod schema.
 * @param {import('zod').ZodSchema} schema
 */
export function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = err.issues || err.errors || [];
        const errorMessages = issues.map((e) => e.message);
        return res.status(400).json({
          success: false,
          error: errorMessages[0] || 'Invalid input data',
          errors: issues.map((e) => ({
            field: Array.isArray(e.path) ? e.path.join('.') : String(e.path || ''),
            message: e.message,
          })),
        });
      }
      next(err);
    }
  };
}
