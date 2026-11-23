// src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';

// Centralized error handling middleware
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  console.error('Error:', err);
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const message =
    isProd && status >= 500
      ? 'حدث خطأ داخلي في الخادم، يرجى المحاولة مرة أخرى.'
      : err.message || 'Internal Server Error';
  res.status(status).json({
    success: false,
    status,
    message,
    ...(!isProd && { stack: err.stack }),
  });
}
