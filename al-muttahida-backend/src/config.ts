import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  // Ensure a strong JWT secret is provided via env var
  jwtSecret: (() => {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret === 'change_me_please') {
      throw new Error('JWT_SECRET is not set or uses insecure default. Please set a strong secret in environment variables.');
    }
    return secret;
  })(),
  sql: {
    server: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 1433),
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'AlMuttahida_New',
    options: {
      encrypt: (process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
      trustServerCertificate: (process.env.DB_TRUST_CERT || 'true').toLowerCase() === 'true',
    },
    // Connection pool settings to prevent deadlocks and pool exhaustion
    pool: {
      max: 50,
      min: 10, // Keep 10 connections alive at all times to prevent cold start latency
      idleTimeoutMillis: 30000, // idle timeout of 30 seconds
      acquireTimeoutMillis: 15000,
    },
    connectionTimeout: 15000,
    requestTimeout: 30000,
    // Add extra options for connection reliability
    connectionOptions: {
      keepAlive: true,
      keepAliveInitialDelay: 10000
    }
  },
};
