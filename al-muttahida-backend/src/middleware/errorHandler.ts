// src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';

// Centralized error handling middleware
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  console.error('Error:', err);
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  res.status(status).json({
    success: false,
    status,
    message,
    // In production you may hide stack trace
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}
