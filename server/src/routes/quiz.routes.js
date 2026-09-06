import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { asyncHandler } from '../lib/http.js';
import { persistImage, uploadImage } from '../lib/upload.js';

const router = Router();

// All quiz-management routes require an authenticated organizer.
router.use(requireAuth, requireRole('organizer'));

// Loads a quiz and verifies the current user owns it.
async function loadOwnedQuiz(req, res) {
  const quiz = await prisma.quiz.findUnique({ where: { id: req.params.id } });
  if (!quiz) {
    res.status(404).json({ error: 'Квиз не найден' });
    return null;
  }
  if (quiz.ownerId !== req.user.id) {
    res.status(403).json({ error: 'Это не ваш квиз' });
    return null;
  }
  return quiz;
}

const quizInclude = {
  questions: {
    orderBy: { orderIndex: 'asc' },
    include: { options: { orderBy: { orderIndex: 'asc' } } },
  },
};

// Accept safe legacy basenames as well as new UUID names; never accept paths,
// query strings, remote URLs, or executable extensions.
const LOCAL_IMAGE_URL = /^\/uploads\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.(?:png|jpe?g|webp|gif)$/;

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

// Coerce a per-question time into a sane 5–300s range; fall back on bad input.
function clampTime(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(300, Math.max(5, Math.round(n)));
}

// Validates and normalizes a question payload. Returns { data } or { error }.
function normalizeQuestion(body, orderIndex) {
  const type = body.type === 'image' ? 'image' : 'text';
  const answerType = body.answerType === 'multiple' ? 'multiple' : 'single';
  const text = cleanText(body.text, 500);
  const options = Array.isArray(body.options) ? body.options : [];

  if (!text) return { error: 'Текст вопроса обязателен' };
  if (options.length < 2 || options.length > 6) {
    return { error: 'Нужно от 2 до 6 вариантов ответа' };
  }
  const cleaned = options.map((o, i) => ({
    text: cleanText(o?.text, 200),
    isCorrect: Boolean(o?.isCorrect),
    orderIndex: i,
  }));
  if (cleaned.some((o) => !o.text)) {
    return { error: 'Все варианты ответа должны быть заполнены' };
  }
  const correctCount = cleaned.filter((o) => o.isCorrect).length;
  if (correctCount === 0) {
    return { error: 'Отметьте хотя бы один правильный вариант' };
  }
  if (answerType === 'single' && correctCount !== 1) {
    return { error: 'Для одиночного выбора должен быть ровно один правильный вариант' };
  }
  if (answerType === 'multiple' && correctCount < 2) {
    return { error: 'Для множественного выбора отметьте не меньше двух правильных вариантов' };
  }

  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : null;
  if (type === 'image' && !imageUrl) {
    return { error: 'Загрузите изображение для вопроса этого типа' };
  }
  if (imageUrl && !LOCAL_IMAGE_URL.test(imageUrl)) {
    return { error: 'Некорректная ссылка на изображение' };
  }

  // Optional per-question time limit: must be a positive integer if provided.
  let timeLimit = null;
  if (body.timeLimit !== null && body.timeLimit !== undefined && body.timeLimit !== '') {
    const t = Number(body.timeLimit);
    if (!Number.isFinite(t) || t < 5 || t > 300) {
      return { error: 'Время на вопрос должно быть от 5 до 300 секунд' };
    }
    timeLimit = Math.round(t);
  }

  return {
    data: { type, answerType, text, imageUrl, timeLimit, orderIndex, options: cleaned },
  };
}

// GET /api/quizzes — list organizer's quizzes with question counts.
router.get('/', asyncHandler(async (req, res) => {
  const quizzes = await prisma.quiz.findMany({
    where: { ownerId: req.user.id },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { questions: true, sessions: true } } },
  });
  res.json({ quizzes });
}));

// POST /api/quizzes — create a quiz shell.
router.post('/', asyncHandler(async (req, res) => {
  const { title, description, category } = req.body || {};
  const cleanTitle = cleanText(title, 120);
  if (!cleanTitle) {
    return res.status(400).json({ error: 'Название квиза обязательно' });
  }
  const quiz = await prisma.quiz.create({
    data: {
      ownerId: req.user.id,
      title: cleanTitle,
      description: cleanText(description, 1_000),
      category: cleanText(category, 80) || 'Общая',
      defaultTimePerQuestion: clampTime(req.body.defaultTimePerQuestion, 20),
      allowAnswerChange: Boolean(req.body.allowAnswerChange),
      speedBonus: req.body.speedBonus === undefined ? true : Boolean(req.body.speedBonus),
    },
    include: quizInclude,
  });
  res.status(201).json({ quiz });
}));

// GET /api/quizzes/:id — full quiz with questions and options.
router.get('/:id', asyncHandler(async (req, res) => {
  const owned = await loadOwnedQuiz(req, res);
  if (!owned) return;
  const quiz = await prisma.quiz.findUnique({
    where: { id: req.params.id },
    include: quizInclude,
  });
  res.json({ quiz });
}));

// PUT /api/quizzes/:id — update quiz settings.
router.put('/:id', asyncHandler(async (req, res) => {
  const owned = await loadOwnedQuiz(req, res);
  if (!owned) return;
  const b = req.body || {};
  if (b.title !== undefined && !cleanText(b.title, 120)) {
    return res.status(400).json({ error: 'Название квиза обязательно' });
  }
  const quiz = await prisma.quiz.update({
    where: { id: req.params.id },
    data: {
      title: b.title !== undefined ? cleanText(b.title, 120) : undefined,
      description: b.description !== undefined ? cleanText(b.description, 1_000) : undefined,
      category: b.category !== undefined ? cleanText(b.category, 80) || 'Общая' : undefined,
      defaultTimePerQuestion:
        b.defaultTimePerQuestion !== undefined
          ? clampTime(b.defaultTimePerQuestion, owned.defaultTimePerQuestion)
          : undefined,
      allowAnswerChange:
        b.allowAnswerChange !== undefined ? Boolean(b.allowAnswerChange) : undefined,
      speedBonus: b.speedBonus !== undefined ? Boolean(b.speedBonus) : undefined,
    },
    include: quizInclude,
  });
  res.json({ quiz });
}));

// DELETE /api/quizzes/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const owned = await loadOwnedQuiz(req, res);
  if (!owned) return;
  await prisma.quiz.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// POST /api/quizzes/:id/questions — append a question with options.
router.post('/:id/questions', asyncHandler(async (req, res) => {
  const owned = await loadOwnedQuiz(req, res);
  if (!owned) return;

  // Place after the current last question. Using max(orderIndex)+1 (not count)
  // avoids collisions when earlier questions were deleted without reindexing.
  const last = await prisma.question.findFirst({
    where: { quizId: owned.id },
    orderBy: { orderIndex: 'desc' },
    select: { orderIndex: true },
  });
  const nextOrder = last ? last.orderIndex + 1 : 0;
  const norm = normalizeQuestion(req.body || {}, nextOrder);
  if (norm.error) return res.status(400).json({ error: norm.error });

  const { options, ...questionData } = norm.data;
  const question = await prisma.question.create({
    data: { ...questionData, quizId: owned.id, options: { create: options } },
    include: { options: { orderBy: { orderIndex: 'asc' } } },
  });
  res.status(201).json({ question });
}));

// PUT /api/quizzes/:id/questions/:qid — replace a question and its options.
router.put('/:id/questions/:qid', asyncHandler(async (req, res) => {
  const owned = await loadOwnedQuiz(req, res);
  if (!owned) return;
  const existing = await prisma.question.findFirst({
    where: { id: req.params.qid, quizId: owned.id },
  });
  if (!existing) return res.status(404).json({ error: 'Вопрос не найден' });

  const norm = normalizeQuestion(req.body || {}, existing.orderIndex);
  if (norm.error) return res.status(400).json({ error: norm.error });

  const { options, ...questionData } = norm.data;
  // Replace the question's options wholesale.
  const question = await prisma.$transaction(async (tx) => {
    await tx.answerOption.deleteMany({ where: { questionId: existing.id } });
    return tx.question.update({
      where: { id: existing.id },
      data: { ...questionData, options: { create: options } },
      include: { options: { orderBy: { orderIndex: 'asc' } } },
    });
  });
  res.json({ question });
}));

// DELETE /api/quizzes/:id/questions/:qid
router.delete('/:id/questions/:qid', asyncHandler(async (req, res) => {
  const owned = await loadOwnedQuiz(req, res);
  if (!owned) return;
  const existing = await prisma.question.findFirst({
    where: { id: req.params.qid, quizId: owned.id },
  });
  if (!existing) return res.status(404).json({ error: 'Вопрос не найден' });
  await prisma.question.delete({ where: { id: existing.id } });
  res.json({ ok: true });
}));

// PUT /api/quizzes/:id/questions-order — persist a new question order.
router.put('/:id/questions-order', asyncHandler(async (req, res) => {
  const owned = await loadOwnedQuiz(req, res);
  if (!owned) return;
  const order = Array.isArray(req.body?.order) ? req.body.order : [];
  const questions = await prisma.question.findMany({
    where: { quizId: owned.id },
    select: { id: true },
  });
  const expectedIds = new Set(questions.map((question) => question.id));
  const uniqueIds = new Set(order);
  if (
    order.length !== expectedIds.size ||
    uniqueIds.size !== order.length ||
    order.some((id) => typeof id !== 'string' || !expectedIds.has(id))
  ) {
    return res.status(400).json({ error: 'Порядок должен содержать все вопросы ровно один раз' });
  }
  await prisma.$transaction(
    order.map((qid, i) =>
      prisma.question.updateMany({
        where: { id: qid, quizId: owned.id },
        data: { orderIndex: i },
      })
    )
  );
  res.json({ ok: true });
}));

// POST /api/quizzes/upload — upload a question image, returns its public URL.
router.post('/upload', uploadImage.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const filename = await persistImage(req.file);
  res.status(201).json({ url: `/uploads/${filename}` });
}));

export default router;
