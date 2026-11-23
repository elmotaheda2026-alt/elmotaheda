// src/middleware/logger.ts
import winston from 'winston';
import { Request, Response, NextFunction } from 'express';

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
  ),
  transports: [new winston.transports.Console()]
});

// Express middleware to log each request
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const { method, url } = req;
  const safeUrl = url.replace(/([?&]token=)[^&]+/gi, '$1[REDACTED]');
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    logger.info(`${method} ${safeUrl} ${statusCode} - ${duration}ms`);
  });
  next();
};

export default logger;
