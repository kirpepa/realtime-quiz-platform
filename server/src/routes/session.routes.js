import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { generateRoomCode } from '../lib/roomCode.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();

// POST /api/sessions — organizer creates a live session (room) for a quiz.
router.post('/', requireAuth, requireRole('organizer'), asyncHandler(async (req, res) => {
  const { quizId } = req.body || {};
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { _count: { select: { questions: true } } },
  });
  if (!quiz) return res.status(404).json({ error: 'Квиз не найден' });
  if (quiz.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Это не ваш квиз' });
  }
  if (quiz._count.questions === 0) {
    return res.status(400).json({ error: 'Нельзя запустить квиз без вопросов' });
  }

  // The unique index is the final authority. Retrying the create itself avoids
  // a check-then-insert race when two sessions are opened concurrently.
  let session = null;
  for (let i = 0; i < 8; i += 1) {
    try {
      session = await prisma.quizSession.create({
        data: { quizId: quiz.id, roomCode: generateRoomCode(), status: 'pending' },
      });
      break;
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
    }
  }
  if (!session) {
    return res.status(503).json({ error: 'Не удалось сгенерировать код комнаты, попробуйте ещё раз' });
  }

  res.status(201).json({ session });
}));

// GET /api/sessions/room/:code — public lookup so participants can validate a
// room code before attempting to join over WebSocket.
router.get('/room/:code', asyncHandler(async (req, res) => {
  const code = typeof req.params.code === 'string' ? req.params.code.toUpperCase() : '';
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    return res.status(400).json({ error: 'Некорректный код комнаты' });
  }
  const session = await prisma.quizSession.findUnique({
    where: { roomCode: code },
    include: { quiz: { select: { title: true, category: true } } },
  });
  if (!session) return res.status(404).json({ error: 'Комната не найдена' });
  res.json({
    session: {
      roomCode: session.roomCode,
      status: session.status,
      quizTitle: session.quiz.title,
      category: session.quiz.category,
    },
  });
}));

export default router;
