import { startDiscoveryService } from './discovery.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import rateLimit from 'express-rate-limit';
import { requestLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { initDb, mssqlPool } from './db.js';
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
import { startAutoBackupScheduler } from './autoBackupService.js';

async function bootstrap() {
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((o) => o.trim());

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
      message: { error: 'تم إرسال عدد كبير جداً من الطلبات، يرجى الانتظار لحظة ثم المحاولة.' },
    })
  );
  app.use(express.json({ limit: '5mb' }));
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

  // Track database connection state for health checks
  let dbStatus: { connected: boolean; error: string | null } = { connected: false, error: null };

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

  // Dedicated DB health check endpoint for Electron setup verification
  const dbHealthHandler = (_req: express.Request, res: express.Response) => {
    if (dbStatus.connected) {
      return res.json({ ok: true, connected: true });
    }
    return res.status(503).json({ ok: false, connected: false, error: dbStatus.error || 'Database is initializing or unreachable' });
  };
  app.get('/health/db', dbHealthHandler);
  app.get('/api/health/db', dbHealthHandler);

  // Swagger setup (development only)
  if (process.env.NODE_ENV !== 'production') {
    const swaggerSpec = swaggerJsdoc({
      definition: {
        openapi: '3.0.0',
        info: { title: 'Al-Muttahida API', version: '1.0.0' },
      },
      apis: ['./src/routes/*.ts'],
    });
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  }

  // System & Network configuration routes
  app.use('/system', systemRoutes);
  app.use('/api/system', systemRoutes);

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

  // Central error handling
  app.use(errorHandler);

  // Start Express server listening immediately so health & system APIs are always available
  const port = config.port || 4000;
  app.listen(port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on http://0.0.0.0:${port}`);
    startDiscoveryService();
  });

  // Initialize Database in the background without crashing the server if initial connection fails
  initDb()
    .then(() => {
      dbStatus = { connected: true, error: null };
      // eslint-disable-next-line no-console
      console.log('Database initialized successfully.');
      startAutoBackupScheduler();
    })
    .catch((err) => {
      dbStatus = { connected: false, error: err.message };
      // eslint-disable-next-line no-console
      console.error('Database initialization warning (can be configured via settings):', err.message);
    });

  // Graceful shutdown: close mssql pool and stop processes cleanly to prevent zombie tasks
  const gracefulShutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[Backend] Received ${signal}. Closing MSSQL connection pool and exiting cleanly...`);
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
