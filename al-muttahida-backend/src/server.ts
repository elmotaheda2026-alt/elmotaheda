import { startDiscoveryService } from './discovery.js';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import rateLimit from 'express-rate-limit';
import { requestLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import jwt from 'jsonwebtoken';
import { subscribeSseClient, broadcastDataChange } from './realtime.js';
import { dbPromise, initDb, mssqlPool } from './db.js';
import { setRolePermissions } from './permissions.js';
import authRoutes from './routes/auth.js';
import salesRoutes from './routes/sales.js';
import paymentRoutes from './routes/payments.js';
import reportRoutes from './routes/reports.js';
import closingRoutes from './routes/closing.js';
import customersRoutes from './routes/customers.js';
import suppliersRoutes from './routes/suppliers.js';
import usersRoutes from './routes/users.js';
import productsRoutes from './routes/products.js';
import purchasesRoutes from './routes/purchases.js';
import expensesRoutes from './routes/expenses.js';
import salesRepsRoutes from './routes/sales-reps.js';
import shareholdersRoutes from './routes/shareholders.js';
import settingsRoutes from './routes/settings.js';
import backupRoutes from './routes/backup.js';
import notificationsRoutes from './routes/notifications.js';
import collectionTasksRoutes from './routes/collection-tasks.js';
import duesRoutes from './routes/dues.js';
import systemRoutes from './routes/system.js';
import documentTemplatesRoutes from './routes/document-templates.js';
import { startAutoBackupScheduler } from './autoBackupService.js';

async function bootstrap() {
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin, null origin (file://), or local file schemes (Electron packaged apps)
        if (!origin || origin === 'null' || origin.startsWith('file:') || origin.startsWith('vscode-file:')) {
          return callback(null, true);
        }
        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        try {
          const url = new URL(origin);
          const hostname = url.hostname;
          // Allow loopback / localhost
          if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
            return callback(null, true);
          }
          // Allow private local network IP ranges: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
          if (
            /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
            /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
            /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)
          ) {
            return callback(null, true);
          }
        } catch {}

        // Reject unknown external internet origins (allow * only if explicitly configured via CORS_ORIGIN=*)
        if (process.env.CORS_ORIGIN && allowedOrigins.includes('*')) {
          return callback(null, true);
        }
        return callback(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
    })
  );
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 600, // generous for ERP LAN polling & normal usage while blocking floods
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) =>
        req.path === '/health' ||
        req.path === '/api/health' ||
        req.path === '/events' ||
        req.path === '/api/events',
      message: { error: 'تم إرسال عدد كبير جداً من الطلبات، يرجى الانتظار لحظة ثم المحاولة.' },
    })
  );
  app.use(express.json({ limit: '100mb' }));
  app.use(morgan('dev'));
  // Request logging
  app.use(requestLogger);

  // Enforce strict read-only mode for mobile devices (blocks all mutations except login/logout)
  app.use((req, res, next) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    const normalizedPath = req.path.toLowerCase();
    if (
      normalizedPath === '/auth/login' ||
      normalizedPath === '/api/auth/login' ||
      normalizedPath === '/auth/logout' ||
      normalizedPath === '/api/auth/logout'
    ) {
      return next();
    }

    const userAgent = String(req.headers['user-agent'] || '');
    const clientDeviceHeader = String(req.headers['x-client-device'] || '').toLowerCase();
    const isMobileClient =
      clientDeviceHeader === 'mobile' ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent);

    if (isMobileClient) {
      return res.status(403).json({
        error: 'وضع العرض فقط: التعديل أو الإضافة أو الحذف غير مسموح من الموبايل لحماية البيانات.',
      });
    }

    return next();
  });

  // Track database connection & initialization state for health checks
  let dbStatus: { connected: boolean; error: string | null } = { connected: false, error: null };
  let initInFlight: Promise<boolean> | null = null;
  let autoBackupStarted = false;

  const ensureDbInitialized = async (): Promise<boolean> => {
    if (dbStatus.connected) return true;
    if (initInFlight) return initInFlight;

    initInFlight = initDb()
      .then(() => {
        dbStatus = { connected: true, error: null };
        // eslint-disable-next-line no-console
        console.log('Database initialized successfully.');
        if (!autoBackupStarted) {
          autoBackupStarted = true;
          startAutoBackupScheduler();
        }
        return true;
      })
      .catch((err: any) => {
        dbStatus = { connected: false, error: err?.message || String(err) };
        // eslint-disable-next-line no-console
        console.error('Database initialization warning (will retry automatically):', dbStatus.error);
        return false;
      })
      .finally(() => {
        initInFlight = null;
      });

    return initInFlight;
  };

  // Health check endpoints (both /health and /api/health)
  const healthHandler = (_req: express.Request, res: express.Response) =>
    res.json({
      ok: true,
      service: 'al-muttahida-backend',
      status: 'running',
      database: dbStatus,
      time: new Date().toISOString()
    });
  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  // Dedicated DB health check endpoint for Electron setup verification (retries DB init on demand)
  const dbHealthHandler = async (_req: express.Request, res: express.Response) => {
    if (!dbStatus.connected) {
      await ensureDbInitialized();
    }
    if (dbStatus.connected) {
      return res.json({ ok: true, connected: true });
    }
    return res.status(503).json({
      ok: false,
      connected: false,
      error: dbStatus.error || 'Database is initializing or unreachable',
    });
  };
  app.get('/health/db', dbHealthHandler);
  app.get('/api/health/db', dbHealthHandler);

  // Swagger setup (development only)
  if (process.env.NODE_ENV !== 'production') {
    try {
      const [{ default: swaggerUi }, { default: swaggerJsdoc }] = await Promise.all([
        import('swagger-ui-express'),
        import('swagger-jsdoc'),
      ]);
      const swaggerSpec = swaggerJsdoc({
        definition: {
          openapi: '3.0.0',
          info: { title: 'Al-Muttahida API', version: '1.0.0' },
        },
        apis: ['./src/routes/*.ts'],
      });
      app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    } catch {
      // Swagger is optional and omitted in production bundles
    }
  }

  // System & Network configuration routes
  app.use('/system', systemRoutes);
  app.use('/api/system', systemRoutes);

  // Real-Time Server-Sent Events (SSE) stream for 20-PC instant LAN sync
  const eventsHandler = (req: express.Request, res: express.Response) => {
    const authHeader = req.headers.authorization || '';
    const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : queryToken.trim();
    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
      jwt.verify(token, config.jwtSecret);
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    subscribeSseClient(req, res);
    return undefined;
  };
  app.get('/events', eventsHandler);
  app.get('/api/events', eventsHandler);

  // Automatic real-time broadcast to all 20 LAN PCs whenever any mutation succeeds
  app.use((req, res, next) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const p = req.path.replace(/^\/api/, '').toLowerCase();
      if (p.startsWith('/customers')) {
        broadcastDataChange('customers', method);
      } else if (p.startsWith('/sales') || p.startsWith('/invoices') || p.startsWith('/contracts') || p.startsWith('/installments')) {
        broadcastDataChange('sales', method);
        broadcastDataChange('customers', method);
        broadcastDataChange('products', method);
        broadcastDataChange('notifications', method);
      } else if (p.startsWith('/payments')) {
        broadcastDataChange('payments', method);
        broadcastDataChange('sales', method);
        broadcastDataChange('customers', method);
        broadcastDataChange('notifications', method);
      } else if (p.startsWith('/products')) {
        broadcastDataChange('products', method);
      } else if (p.startsWith('/suppliers') || p.startsWith('/purchases')) {
        broadcastDataChange('suppliers', method);
        broadcastDataChange('products', method);
        broadcastDataChange('payments', method);
      } else if (p.startsWith('/expenses')) {
        broadcastDataChange('expenses', method);
        broadcastDataChange('payments', method);
      } else if (p.startsWith('/shareholders')) {
        broadcastDataChange('shareholders', method);
        broadcastDataChange('payments', method);
      } else if (p.startsWith('/notifications')) {
        broadcastDataChange('notifications', method);
      } else if (p.startsWith('/closing')) {
        broadcastDataChange('payments', method);
        broadcastDataChange('sales', method);
      } else if (p.startsWith('/settings')) {
        broadcastDataChange('settings', method);
      }
    });
    return next();
  });

  // Business domain routes
  app.use('/auth', authRoutes);
  app.use('/api/auth', authRoutes);

  app.use('/sales', salesRoutes);
  app.use('/api/sales', salesRoutes);
  app.use('/contracts', salesRoutes);
  app.use('/api/contracts', salesRoutes);
  app.use('/invoices', salesRoutes);
  app.use('/api/invoices', salesRoutes);
  app.use('/installments', salesRoutes);
  app.use('/api/installments', salesRoutes);

  app.use('/payments', paymentRoutes);
  app.use('/api/payments', paymentRoutes);

  app.use('/reports', reportRoutes);
  app.use('/api/reports', reportRoutes);

  app.use('/closing', closingRoutes);
  app.use('/api/closing', closingRoutes);

  app.use('/customers', customersRoutes);
  app.use('/api/customers', customersRoutes);

  app.use('/suppliers', suppliersRoutes);
  app.use('/api/suppliers', suppliersRoutes);

  app.use('/users', usersRoutes);
  app.use('/api/users', usersRoutes);

  app.use('/products', productsRoutes);
  app.use('/api/products', productsRoutes);

  app.use('/purchases', purchasesRoutes);
  app.use('/api/purchases', purchasesRoutes);

  app.use('/expenses', expensesRoutes);
  app.use('/api/expenses', expensesRoutes);

  app.use('/sales-reps', salesRepsRoutes);
  app.use('/api/sales-reps', salesRepsRoutes);

  app.use('/shareholders', shareholdersRoutes);
  app.use('/api/shareholders', shareholdersRoutes);

  app.use('/settings', settingsRoutes);
  app.use('/api/settings', settingsRoutes);

  app.use('/settings', backupRoutes);
  app.use('/api/settings', backupRoutes);

  app.use('/notifications', notificationsRoutes);
  app.use('/api/notifications', notificationsRoutes);

  app.use('/collection-tasks', collectionTasksRoutes);
  app.use('/api/collection-tasks', collectionTasksRoutes);

  app.use('/dues', duesRoutes);
  app.use('/api/dues', duesRoutes);

  app.use('/document-templates', documentTemplatesRoutes);
  app.use('/api/document-templates', documentTemplatesRoutes);

  // Serve built frontend static files so LAN browsers can open http://<server-ip>:4000 directly
  const currentDir =
    typeof __dirname !== 'undefined'
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));
  const candidateFrontendDirs = [
    path.resolve(currentDir, '..', 'frontend'),
    path.resolve(currentDir, '..', '..', 'al-muttahida-saas', 'dist'),
  ];
  const frontendDir = candidateFrontendDirs.find((dir) => fs.existsSync(path.join(dir, 'index.html')));
  if (frontendDir) {
    app.use(express.static(frontendDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/health')) return next();
      return res.sendFile(path.join(frontendDir, 'index.html'));
    });
  }

  // Central error handling
  app.use(errorHandler);

  // Start Express server listening immediately so health & system APIs are always available
  const port = config.port || 4000;
  app.listen(port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on http://0.0.0.0:${port}`);
    startDiscoveryService();
  });

  const syncRolePermissionsFromDb = async () => {
    try {
      const db = await dbPromise;
      const col = await db.get<any>(`SELECT COL_LENGTH('settings', 'role_permissions_json') AS len`);
      if (!col?.len) return;
      const row = await db.get<{ role_permissions_json?: string | null }>('SELECT TOP 1 role_permissions_json FROM settings');
      if (row?.role_permissions_json) {
        const parsed = JSON.parse(row.role_permissions_json);
        if (parsed && typeof parsed === 'object') {
          setRolePermissions(parsed);
        }
      }
    } catch {
      // Ignore startup role permission sync errors
    }
  };

  // Initialize Database in the background and retry every 4s until connected & schema initialized
  let dbRetryTimer: ReturnType<typeof setInterval> | null = null;
  ensureDbInitialized().then((connected) => {
    if (connected) {
      void syncRolePermissionsFromDb();
    }
    if (!connected && !dbRetryTimer) {
      dbRetryTimer = setInterval(() => {
        if (dbStatus.connected) {
          if (dbRetryTimer) {
            clearInterval(dbRetryTimer);
            dbRetryTimer = null;
          }
          return;
        }
        void ensureDbInitialized().then((ok) => {
          if (ok) {
            void syncRolePermissionsFromDb();
          }
          if (ok && dbRetryTimer) {
            clearInterval(dbRetryTimer);
            dbRetryTimer = null;
          }
        });
      }, 4000);
    }
  });

  // Graceful shutdown: close mssql pool and stop processes cleanly to prevent zombie tasks
  const gracefulShutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[Backend] Received ${signal}. Closing MSSQL connection pool and exiting cleanly...`);
    if (dbRetryTimer) {
      clearInterval(dbRetryTimer);
      dbRetryTimer = null;
    }
    try {
      if (mssqlPool) {
        await mssqlPool.close();
      }
    } catch (_) {}
    process.exit(0);
  };

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  process.on('message', (msg) => {
    if (msg === 'shutdown') {
      void gracefulShutdown('message shutdown');
    }
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
