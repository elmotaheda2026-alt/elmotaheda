import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { initDb } from './db.js';
import authRoutes from './routes/auth.js';
import salesRoutes from './routes/sales.js';
import paymentRoutes from './routes/payments.js';
import reportRoutes from './routes/reports.js';
import closingRoutes from './routes/closing.js';

async function bootstrap() {
  await initDb();

  const app = express();
  app.use(cors());
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'al-muttahida-backend' }));
  app.use('/auth', authRoutes);
  app.use('/sales', salesRoutes);
  app.use('/payments', paymentRoutes);
  app.use('/reports', reportRoutes);
  app.use('/closing', closingRoutes);

  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on http://localhost:${config.port}`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
