import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();
router.use(requireAuth);

// GET /api/me/sessions — organizer history: sessions of the user's quizzes.
router.get('/sessions', asyncHandler(async (req, res) => {
  const sessions = await prisma.quizSession.findMany({
    where: { quiz: { ownerId: req.user.id } },
    orderBy: { createdAt: 'desc' },
    include: {
      quiz: { select: { id: true, title: true, category: true } },
      participants: {
        orderBy: { score: 'desc' },
        select: { id: true, nickname: true, score: true },
      },
      _count: { select: { participants: true } },
    },
  });
  res.json({ sessions });
}));

// GET /api/me/participations — participant history: sessions the user joined.
router.get('/participations', asyncHandler(async (req, res) => {
  const participations = await prisma.sessionParticipant.findMany({
    where: { userId: req.user.id },
    orderBy: { joinedAt: 'desc' },
    include: {
      session: {
        include: {
          quiz: { select: { title: true, category: true } },
          participants: { select: { id: true, score: true } },
        },
      },
    },
  });

  // Compute each participation's final rank within its session.
  const result = participations.map((p) => {
    const scores = p.session.participants
      .map((x) => x.score)
      .sort((a, b) => b - a);
    const rank = scores.indexOf(p.score) + 1;
    return {
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      rank,
      totalParticipants: scores.length,
      joinedAt: p.joinedAt,
      session: {
        id: p.session.id,
        roomCode: p.session.roomCode,
        status: p.session.status,
        finishedAt: p.session.finishedAt,
        quiz: p.session.quiz,
      },
    };
  });
  res.json({ participations: result });
}));

export default router;
