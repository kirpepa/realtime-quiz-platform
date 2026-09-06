import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { Server as SocketServer } from 'socket.io';

import { config } from './config.js';
import { prisma } from './db.js';
import { asyncHandler } from './lib/http.js';
import { MAX_IMAGE_BYTES, UPLOAD_DIR } from './lib/upload.js';
import { initSockets, shutdownLiveRooms } from './socket/sessionManager.js';

import authRoutes from './routes/auth.routes.js';
import quizRoutes from './routes/quiz.routes.js';
import sessionRoutes from './routes/session.routes.js';
import meRoutes from './routes/me.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');
const app = express();
let shuttingDown = false;

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use((req, res, next) => {
  req.requestId = req.get('x-request-id')?.slice(0, 100) || randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});
app.use(
  helmet({
    // Images are served from port 4000 during local Vite development.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

function originAllowed(origin) {
  if (!origin) return true;
  return config.clientOrigins.includes(origin.replace(/\/$/, ''));
}

const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (originAllowed(origin)) callback(null, true);
    else {
      const error = new Error('Origin не разрешён политикой CORS');
      error.status = 403;
      error.expose = true;
      callback(error);
    }
  },
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '512kb', strict: true }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, попробуйте позже' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа, попробуйте позже' },
});
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Лимит загрузок исчерпан, попробуйте позже' },
});

app.get('/api/health', (_req, res) => {
  res.status(shuttingDown ? 503 : 200).json({ status: shuttingDown ? 'stopping' : 'ok' });
});
app.get('/api/health/ready', asyncHandler(async (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'stopping' });
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: 'ready' });
}));

app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/refresh', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/quizzes/upload', uploadLimiter);
app.use('/api/quizzes', quizRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/me', meRoutes);

app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    dotfiles: 'deny',
    fallthrough: false,
    immutable: true,
    maxAge: '7d',
    setHeaders(res) {
      res.setHeader('x-content-type-options', 'nosniff');
    },
  })
);

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (
      req.method === 'GET' &&
      !req.path.startsWith('/api/') &&
      !req.path.startsWith('/uploads/') &&
      req.accepts('html')
    ) {
      return res.sendFile(path.join(clientDist, 'index.html'));
    }
    next();
  });
}

app.use((req, res) => {
  res.status(404).json({ error: 'Маршрут не найден' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = Number.isInteger(err.status) ? err.status : 500;
  if (status < 400 || status > 599) status = 500;
  if (err.type === 'entity.parse.failed') status = 400;
  if (err.code === 'LIMIT_FILE_SIZE') status = 413;
  if (err.code?.startsWith?.('LIMIT_')) status = status === 500 ? 400 : status;

  const safeMessage =
    status === 413
      ? `Изображение должно быть не больше ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} МБ`
      : err.expose || status < 500
        ? err.message
        : 'Внутренняя ошибка сервера';

  console.error(JSON.stringify({
    level: 'error',
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    status,
    error: err.message,
  }));
  res.status(status).json({ error: safeMessage, requestId: req.requestId });
});

const server = http.createServer(app);
server.requestTimeout = 15_000;
server.headersTimeout = 16_000;
server.keepAliveTimeout = 5_000;

const io = new SocketServer(server, {
  cors: corsOptions,
  serveClient: false,
  maxHttpBufferSize: 64 * 1024,
  connectTimeout: 10_000,
  allowRequest(req, callback) {
    callback(null, originAllowed(req.headers.origin));
  },
});
initSockets(io);

async function start() {
  await prisma.$connect();
  // Live state is intentionally in memory. Sessions interrupted by a process
  // restart cannot be resumed safely, so record them as finished explicitly.
  await prisma.quizSession.updateMany({
    where: { status: 'active' },
    data: { status: 'finished', finishedAt: new Date() },
  });
  server.listen(config.port, () => {
    console.log(`API + WebSocket слушают на http://localhost:${config.port}`);
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: завершаем активные соединения`);

  const forceTimer = setTimeout(() => {
    console.error('Graceful shutdown превысил лимит времени');
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceTimer.unref();

  try {
    await shutdownLiveRooms(io);
  } catch (error) {
    console.error('Не удалось полностью сохранить состояние при остановке:', error);
    io.disconnectSockets(true);
  }
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect().catch((error) => {
    console.error('Ошибка отключения Prisma:', error);
  });
  clearTimeout(forceTimer);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  void shutdown('unhandledRejection').then(() => {
    process.exitCode = 1;
  });
});

start().catch(async (error) => {
  console.error('Не удалось запустить сервер:', error);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
