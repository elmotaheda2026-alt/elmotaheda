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

async function bootstrap() {
  await initDb();

  const app = express();
  app.use(cors());
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));
  // Request logging
  app.use(requestLogger);
  // Rate limiting
  // Rate limiting disabled for development
// app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'al-muttahida-backend' }));
  // Swagger setup
  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: '3.0.0',
      info: { title: 'Al‑Muttahida API', version: '1.0.0' },
    },
    apis: ['./src/routes/*.ts'],
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use('/auth', authRoutes);
  app.use('/sales', salesRoutes);
  app.use('/payments', paymentRoutes);
  app.use('/reports', reportRoutes);
  app.use('/closing', closingRoutes);
  app.use('/customers', customersRoutes);
  app.use('/suppliers', suppliersRoutes);
  app.use('/users', usersRoutes);
  app.use('/products', productsRoutes);
  app.use('/purchases', purchasesRoutes);
  app.use('/expenses', expensesRoutes);
  app.use('/sales-reps', salesRepsRoutes);
  app.use('/shareholders', shareholdersRoutes);
  app.use('/settings', settingsRoutes);
  app.use('/settings', backupRoutes);
  app.use('/notifications', notificationsRoutes);
  app.use('/collection-tasks', collectionTasksRoutes);
  // Central error handling
  app.use(errorHandler);

  app.listen(config.port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on http://0.0.0.0:${config.port}`);
    console.log(`Network access: http://192.168.1.6:${config.port}`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
