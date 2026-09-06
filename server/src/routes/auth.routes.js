import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  role: u.role,
  nickname: u.nickname,
});

function issueTokens(user) {
  const payload = { id: user.id, role: user.role, nickname: user.nickname };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validateRegistration(body) {
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password : '';
  const nickname = typeof body?.nickname === 'string' ? body.nickname.trim() : '';

  if (!email || !password || !nickname) {
    return { error: 'Email, пароль и никнейм обязательны' };
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Некорректный email' };
  }
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return { error: 'Пароль должен содержать 8–72 байта' };
  }
  if (nickname.length > 40) return { error: 'Никнейм должен быть не длиннее 40 символов' };

  return { email, password, nickname };
}

// POST /api/auth/register
router.post('/register', asyncHandler(async (req, res) => {
  const validated = validateRegistration(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const { email, password, nickname } = validated;
  const { role } = req.body;
  const normalizedRole = role === 'organizer' ? 'organizer' : 'participant';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  let user;
  try {
    user = await prisma.user.create({
      data: { email, passwordHash, nickname, role: normalizedRole },
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
    }
    throw error;
  }

  const tokens = issueTokens(user);
  res.status(201).json({ user: publicUser(user), ...tokens });
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'Email и пароль обязательны' });
  }
  if (email.length > 254 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  const tokens = issueTokens(user);
  res.json({ user: publicUser(user), ...tokens });
}));

// POST /api/auth/refresh
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken обязателен' });
  }
  try {
    const decoded = verifyRefreshToken(refreshToken);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
    const tokens = issueTokens(user);
    res.json({ user: publicUser(user), ...tokens });
  } catch {
    res.status(401).json({ error: 'Недействительный refresh-токен' });
  }
}));

// GET /api/auth/me
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ user: publicUser(user) });
}));

export default router;
