import 'dotenv/config';

const environment = process.env.NODE_ENV || 'development';
const isTest = environment === 'test';

function parsePort(value) {
  const port = Number(value ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT должен быть целым числом от 1 до 65535');
  }
  return port;
}

function jwtSecret(name, testValue) {
  const value = process.env[name];
  if (!value && isTest) return testValue;
  if (!value) {
    throw new Error(`${name} обязателен. Скопируйте server/.env.example в server/.env.`);
  }
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error(`${name} должен содержать не менее 32 байт`);
  }
  return value;
}

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} должен быть положительным целым числом`);
  }
  return parsed;
}

const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

const accessSecret = jwtSecret(
  'JWT_ACCESS_SECRET',
  'test-only-access-secret-at-least-32-bytes'
);
const refreshSecret = jwtSecret(
  'JWT_REFRESH_SECRET',
  'test-only-refresh-secret-at-least-32-bytes'
);
if (accessSecret === refreshSecret) {
  throw new Error('JWT_ACCESS_SECRET и JWT_REFRESH_SECRET должны отличаться');
}

export const config = Object.freeze({
  environment,
  isProduction: environment === 'production',
  port: parsePort(process.env.PORT),
  clientOrigins,
  trustProxy: process.env.TRUST_PROXY === 'true' ? 1 : false,
  shutdownTimeoutMs: positiveInteger(
    process.env.SHUTDOWN_TIMEOUT_MS,
    10_000,
    'SHUTDOWN_TIMEOUT_MS'
  ),
  maxParticipantsPerRoom: positiveInteger(
    process.env.MAX_PARTICIPANTS_PER_ROOM,
    200,
    'MAX_PARTICIPANTS_PER_ROOM'
  ),
  jwt: Object.freeze({
    accessSecret,
    refreshSecret,
    accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
    refreshTtl: process.env.REFRESH_TOKEN_TTL || '7d',
    issuer: 'vk-quiz-api',
    audience: 'vk-quiz-client',
  }),
});
