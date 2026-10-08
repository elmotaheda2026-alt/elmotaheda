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
import { initDb } from './db.js';
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
import systemRoutes from './routes/system.js';

async function bootstrap() {
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((o) => o.trim());

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS origin '${origin}' not allowed.`));
        }
      },
      credentials: true,
    })
  );
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '5mb' }));
  app.use(morgan('dev'));
  // Request logging
  app.use(requestLogger);

  // Health check endpoints (both /health and /api/health)
  const healthHandler = (_req: express.Request, res: express.Response) =>
    res.json({ ok: true, service: 'al-muttahida-backend', status: 'running', time: new Date().toISOString() });
  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  // Swagger setup
  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: '3.0.0',
      info: { title: 'Al-Muttahida API', version: '1.0.0' },
    },
    apis: ['./src/routes/*.ts'],
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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
      // eslint-disable-next-line no-console
      console.log('Database initialized successfully.');
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Database initialization warning (can be configured via settings):', err.message);
    });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
