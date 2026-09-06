import { nanoid } from 'nanoid';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { verifyAccessToken } from '../auth/jwt.js';
import { isAnswerCorrect, computeScore } from '../lib/scoring.js';

// Realtime state is deliberately process-local. Persisted answers and scores
// remain authoritative; a deployment therefore runs one application replica.
const liveRooms = new Map();

function publicQuestion(room) {
  const question = room.currentQuestion;
  if (!question) return null;
  return {
    id: question.id,
    index: room.currentIndex,
    total: room.quiz.questions.length,
    type: question.type,
    answerType: question.answerType,
    text: question.text,
    imageUrl: question.imageUrl,
    options: question.options.map((option) => ({ id: option.id, text: option.text })),
    timeLimitMs: room.questionTimeLimitMs,
    endsAt: room.questionEndsAt,
    serverNow: Date.now(),
  };
}

function leaderboard(room) {
  return [...room.participants.values()]
    .map((participant) => ({
      participantId: participant.id,
      nickname: participant.nickname,
      score: participant.score,
      connected: participant.connected,
    }))
    .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));
}

function participantList(room) {
  return [...room.participants.values()].map((participant) => ({
    participantId: participant.id,
    nickname: participant.nickname,
    connected: participant.connected,
    score: participant.score,
  }));
}

function questionTimeLimit(room, question) {
  return (question.timeLimit || room.quiz.defaultTimePerQuestion || 20) * 1000;
}

function onAsync(socket, event, handler) {
  socket.on(event, (payload = {}, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    socket.data.pendingEvents ||= new Set();
    if (socket.data.pendingEvents.has(event)) {
      ack({ error: 'Предыдущая операция этого типа ещё выполняется' });
      return;
    }
    socket.data.pendingEvents.add(event);
    Promise.resolve(handler(payload && typeof payload === 'object' ? payload : {}, ack))
      .catch((error) => {
        console.error(`Socket event ${event} failed:`, error);
        ack({ error: 'Внутренняя ошибка сервера' });
      })
      .finally(() => socket.data.pendingEvents.delete(event));
  });
}

function consumeEventQuota(socket, key, limit, windowMs) {
  socket.data.eventQuotas ||= new Map();
  const now = Date.now();
  const current = socket.data.eventQuotas.get(key);
  if (!current || current.resetAt <= now) {
    socket.data.eventQuotas.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function getOrganizerRoom(socket) {
  if (socket.data?.role !== 'organizer') return null;
  const room = liveRooms.get(socket.data.roomCode);
  return room?.organizerSocketId === socket.id ? room : null;
}

function detachSocket(io, socket, notify = true) {
  const { role, roomCode, participantId } = socket.data || {};
  const room = liveRooms.get(roomCode);
  if (!room) return;

  if (role === 'participant' && participantId) {
    const participant = room.participants.get(participantId);
    // A stale, replaced socket must not mark the new connection offline.
    if (participant?.socketId === socket.id) {
      participant.connected = false;
      participant.socketId = null;
      if (notify) io.to(room.roomCode).emit('room:participants', participantList(room));
    }
  }
  if (role === 'organizer' && room.organizerSocketId === socket.id) {
    room.organizerSocketId = null;
  }
  socket.leave(roomCode);
  delete socket.data.role;
  delete socket.data.roomCode;
  delete socket.data.participantId;
  delete socket.data.userId;
}

function replaceSocket(io, socketId) {
  if (!socketId) return;
  const oldSocket = io.sockets.sockets.get(socketId);
  if (!oldSocket) return;
  oldSocket.emit('session:replaced', {
    message: 'Эта игровая сессия открыта в другой вкладке или на другом устройстве',
  });
  detachSocket(io, oldSocket);
}

function cleanNickname(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, 40);
}

function ownAnswer(room, participant) {
  const answer = room.answers.get(participant.id);
  if (!answer) return null;
  return {
    optionIds: answer.optionIds,
    ...(room.status === 'reveal'
      ? {
          correct: answer.correct,
          scoreAwarded: answer.score,
          totalScore: participant.score,
        }
      : {}),
  };
}

export function initSockets(io) {
  io.on('connection', (socket) => {
    onAsync(socket, 'organizer:open', async ({ sessionId, token }, ack) => {
      if (!consumeEventQuota(socket, 'organizer:open', 12, 60_000)) {
        return ack({ error: 'Слишком много попыток открыть сессию' });
      }
      if (typeof sessionId !== 'string' || typeof token !== 'string') {
        return ack({ error: 'Требуется авторизация организатора' });
      }

      let user;
      try {
        user = verifyAccessToken(token);
      } catch {
        return ack({ error: 'Недействительный или истёкший токен' });
      }

      const session = await prisma.quizSession.findUnique({
        where: { id: sessionId },
        include: {
          quiz: {
            include: {
              questions: {
                orderBy: { orderIndex: 'asc' },
                include: { options: { orderBy: { orderIndex: 'asc' } } },
              },
            },
          },
        },
      });
      if (!session) return ack({ error: 'Сессия не найдена' });
      if (session.quiz.ownerId !== user.id) return ack({ error: 'Это не ваша сессия' });
      if (session.status === 'finished') return ack({ error: 'Сессия уже завершена' });

      let room = liveRooms.get(session.roomCode);
      if (!room) {
        room = {
          roomCode: session.roomCode,
          sessionId: session.id,
          quiz: session.quiz,
          status: 'lobby',
          organizerSocketId: null,
          participants: new Map(),
          currentIndex: -1,
          currentQuestion: null,
          questionEndsAt: null,
          questionTimeLimitMs: null,
          timer: null,
          cleanupTimer: null,
          answers: new Map(),
          lastReveal: null,
          transitioning: false,
          revealRetryCount: 0,
        };
        liveRooms.set(session.roomCode, room);
      }

      if (room.sessionId !== session.id) return ack({ error: 'Конфликт состояния комнаты' });
      if (room.organizerSocketId && room.organizerSocketId !== socket.id) {
        replaceSocket(io, room.organizerSocketId);
      }
      if (
        socket.data.role &&
        (socket.data.role !== 'organizer' || socket.data.roomCode !== room.roomCode)
      ) {
        detachSocket(io, socket);
      }

      room.organizerSocketId = socket.id;
      Object.assign(socket.data, {
        role: 'organizer',
        roomCode: session.roomCode,
        userId: user.id,
      });
      socket.join(session.roomCode);

      ack({
        ok: true,
        roomCode: session.roomCode,
        quizTitle: session.quiz.title,
        status: room.status,
        participants: participantList(room),
        currentQuestion:
          room.status === 'question' || room.status === 'reveal' ? publicQuestion(room) : null,
        reveal: room.status === 'reveal' ? room.lastReveal : null,
        leaderboard: leaderboard(room),
        progress: {
          answered: room.answers.size,
          total: [...room.participants.values()].filter((p) => p.connected).length,
        },
      });
    });

    onAsync(
      socket,
      'room:join',
      async ({ roomCode, nickname, token, participantId, rejoinToken }, ack) => {
        if (!consumeEventQuota(socket, 'room:join', 10, 60_000)) {
          return ack({ error: 'Слишком много попыток входа в комнату' });
        }
        const code = typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : '';
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
          return ack({ error: 'Некорректный код комнаты' });
        }

        const room = liveRooms.get(code);
        const dbSession = await prisma.quizSession.findUnique({ where: { roomCode: code } });
        if (!dbSession) return ack({ error: 'Комната не найдена' });
        if (dbSession.status === 'finished' || room?.status === 'finished') {
          return ack({ error: 'Квиз уже завершён' });
        }
        if (!room) return ack({ error: 'Организатор ещё не открыл комнату' });

        let userId = null;
        if (token !== undefined && token !== null && token !== '') {
          if (typeof token !== 'string') return ack({ error: 'Недействительный токен' });
          try {
            const decoded = verifyAccessToken(token);
            const user = await prisma.user.findUnique({
              where: { id: decoded.id },
              select: { id: true },
            });
            if (!user) return ack({ error: 'Пользователь не найден' });
            userId = user.id;
          } catch {
            return ack({ error: 'Недействительный или истёкший токен' });
          }
        }

        let participant = null;
        if (socket.data.role === 'participant' && socket.data.roomCode === code) {
          const bound = room.participants.get(socket.data.participantId);
          if (bound?.socketId === socket.id) participant = bound;
        }
        if (typeof participantId === 'string') {
          const existing = room.participants.get(participantId);
          if (
            existing &&
            ((typeof rejoinToken === 'string' && existing.rejoinToken === rejoinToken) ||
              (userId && existing.userId === userId))
          ) {
            participant = existing;
          }
        }
        if (!participant && userId) {
          participant = [...room.participants.values()].find((p) => p.userId === userId) || null;
        }

        if (!participant) {
          if (room.participants.size >= config.maxParticipantsPerRoom) {
            return ack({ error: 'Комната заполнена' });
          }
          const cleanNick = cleanNickname(nickname);
          if (!cleanNick) return ack({ error: 'Введите никнейм' });

          let dbParticipant;
          if (userId) {
            dbParticipant = await prisma.sessionParticipant.upsert({
              where: { sessionId_userId: { sessionId: room.sessionId, userId } },
              create: { sessionId: room.sessionId, userId, nickname: cleanNick },
              update: {},
            });
            participant = room.participants.get(dbParticipant.id) || null;
          } else {
            dbParticipant = await prisma.sessionParticipant.create({
              data: { sessionId: room.sessionId, nickname: cleanNick },
            });
          }

          if (!participant) {
            participant = {
              id: dbParticipant.id,
              nickname: dbParticipant.nickname,
              userId,
              socketId: null,
              score: dbParticipant.score,
              connected: false,
              rejoinToken: nanoid(32),
            };
            room.participants.set(participant.id, participant);
          }
        }

        if (participant.socketId && participant.socketId !== socket.id) {
          replaceSocket(io, participant.socketId);
        }
        if (
          socket.data.role &&
          (socket.data.role !== 'participant' ||
            socket.data.roomCode !== code ||
            socket.data.participantId !== participant.id)
        ) {
          detachSocket(io, socket);
        }

        participant.socketId = socket.id;
        participant.connected = true;
        Object.assign(socket.data, {
          role: 'participant',
          roomCode: code,
          participantId: participant.id,
          userId,
        });
        socket.join(code);

        const answer = ownAnswer(room, participant);
        ack({
          ok: true,
          participantId: participant.id,
          rejoinToken: participant.rejoinToken,
          nickname: participant.nickname,
          status: room.status,
          quizTitle: room.quiz.title,
          currentQuestion:
            room.status === 'question' || room.status === 'reveal' ? publicQuestion(room) : null,
          reveal: room.status === 'reveal' ? room.lastReveal : null,
          leaderboard: leaderboard(room),
          ownAnswer: answer,
        });

        if (room.status === 'question' && answer) {
          socket.emit('question:answered_ack', { optionIds: answer.optionIds });
        }
        io.to(room.roomCode).emit('room:participants', participantList(room));
      }
    );

    onAsync(socket, 'room:leave', async ({ role, roomCode, participantId, sessionId }, ack) => {
      const currentRoom = liveRooms.get(socket.data?.roomCode);
      const matchesParticipant =
        role === 'participant' &&
        socket.data?.role === 'participant' &&
        socket.data?.roomCode === roomCode &&
        socket.data?.participantId === participantId;
      const matchesOrganizer =
        role === 'organizer' &&
        socket.data?.role === 'organizer' &&
        currentRoom?.sessionId === sessionId;
      if (matchesParticipant || matchesOrganizer) detachSocket(io, socket);
      ack({ ok: true });
    });

    onAsync(socket, 'quiz:start', async (_payload, ack) => {
      const room = getOrganizerRoom(socket);
      if (!room) return ack({ error: 'Нет активной сессии' });
      if (room.transitioning) return ack({ error: 'Предыдущая операция ещё выполняется' });
      if (room.status !== 'lobby') return ack({ error: 'Квиз уже запущен' });
      if (![...room.participants.values()].some((participant) => participant.connected)) {
        return ack({ error: 'Нет подключённых участников' });
      }

      room.transitioning = true;
      try {
        await prisma.quizSession.update({
          where: { id: room.sessionId },
          data: { status: 'active', startedAt: new Date() },
        });
        showQuestion(io, room, 0);
        ack({ ok: true });
      } finally {
        room.transitioning = false;
      }
    });

    onAsync(socket, 'quiz:next', async (_payload, ack) => {
      const room = getOrganizerRoom(socket);
      if (!room) return ack({ error: 'Нет активной сессии' });
      if (room.transitioning) return ack({ error: 'Предыдущая операция ещё выполняется' });
      if (room.status !== 'reveal') {
        return ack({ error: 'Дождитесь показа ответа перед переходом дальше' });
      }
      const nextIndex = room.currentIndex + 1;
      if (nextIndex >= room.quiz.questions.length) {
        const result = await finishQuiz(io, room);
        return ack(result);
      }
      showQuestion(io, room, nextIndex);
      ack({ ok: true });
    });

    onAsync(socket, 'quiz:reveal', async (_payload, ack) => {
      const room = getOrganizerRoom(socket);
      if (!room) return ack({ error: 'Нет активной сессии' });
      if (room.status !== 'question') return ack({ error: 'Сейчас нет активного вопроса' });
      const result = await revealQuestion(io, room);
      ack(result);
    });

    onAsync(socket, 'question:answer', async ({ optionIds }, ack) => {
      if (!consumeEventQuota(socket, 'question:answer', 30, 10_000)) {
        return ack({ error: 'Слишком много попыток ответа' });
      }
      const room = liveRooms.get(socket.data?.roomCode);
      const participantId = socket.data?.participantId;
      const participant = room?.participants.get(participantId);
      if (!room || !participantId || participant?.socketId !== socket.id) {
        return ack({ error: 'Вы не в комнате' });
      }
      if (room.status !== 'question') return ack({ error: 'Сейчас нельзя отвечать' });
      if (room.transitioning) return ack({ error: 'Результаты уже сохраняются' });
      if (Date.now() > room.questionEndsAt) return ack({ error: 'Время на ответ истекло' });
      if (room.answers.has(participantId) && !room.quiz.allowAnswerChange) {
        return ack({ error: 'Изменение ответа запрещено' });
      }

      if (!Array.isArray(optionIds) || optionIds.length > 6) {
        return ack({ error: 'Некорректный список ответов' });
      }
      const selected = [...new Set(optionIds)];
      if (selected.some((id) => typeof id !== 'string')) {
        return ack({ error: 'Некорректный список ответов' });
      }
      const question = room.currentQuestion;
      const validIds = new Set(question.options.map((option) => option.id));
      if (selected.length === 0) return ack({ error: 'Выберите вариант ответа' });
      if (selected.some((id) => !validIds.has(id))) {
        return ack({ error: 'Ответ содержит неизвестный вариант' });
      }
      if (question.answerType === 'single' && selected.length !== 1) {
        return ack({ error: 'Можно выбрать только один вариант' });
      }

      const correctIds = question.options
        .filter((option) => option.isCorrect)
        .map((option) => option.id);
      const correct = isAnswerCorrect(correctIds, selected);
      const score = computeScore({
        correct,
        speedBonus: room.quiz.speedBonus,
        timeLeftMs: room.questionEndsAt - Date.now(),
        timeLimitMs: room.questionTimeLimitMs,
      });

      room.answers.set(participantId, { optionIds: selected, correct, score });
      ack({ ok: true });
      socket.emit('question:answered_ack', { optionIds: selected });

      io.to(room.organizerSocketId).emit('question:progress', {
        answered: room.answers.size,
        total: [...room.participants.values()].filter((p) => p.connected).length,
      });

      if (!room.quiz.allowAnswerChange && allConnectedAnswered(room)) {
        await revealQuestion(io, room);
      }
    });

    socket.on('disconnect', () => {
      const room = liveRooms.get(socket.data?.roomCode);
      detachSocket(io, socket);
      if (
        room?.status === 'question' &&
        !room.quiz.allowAnswerChange &&
        !room.transitioning &&
        allConnectedAnswered(room)
      ) {
        void revealQuestion(io, room).catch((error) => {
          console.error(`Auto-reveal failed for room ${room.roomCode}:`, error);
        });
      }
    });
  });
}

function allConnectedAnswered(room) {
  const connected = [...room.participants.values()].filter((participant) => participant.connected);
  return connected.length > 0 && connected.every((participant) => room.answers.has(participant.id));
}

function showQuestion(io, room, index) {
  if (room.timer) clearTimeout(room.timer);
  const question = room.quiz.questions[index];
  room.status = 'question';
  room.currentIndex = index;
  room.currentQuestion = question;
  room.answers = new Map();
  room.lastReveal = null;
  room.revealRetryCount = 0;
  room.questionTimeLimitMs = questionTimeLimit(room, question);
  room.questionEndsAt = Date.now() + room.questionTimeLimitMs;

  io.to(room.roomCode).emit('question:show', publicQuestion(room));
  io.to(room.organizerSocketId).emit('question:progress', {
    answered: 0,
    total: [...room.participants.values()].filter((participant) => participant.connected).length,
  });

  room.timer = setTimeout(() => {
    void timedReveal(io, room).catch((error) => {
      console.error(`Timed reveal failed for room ${room.roomCode}:`, error);
    });
  }, room.questionTimeLimitMs + 200);
  room.timer.unref?.();
}

async function timedReveal(io, room) {
  const result = await revealQuestion(io, room);
  if (result.error && room.status === 'question' && room.revealRetryCount < 3) {
    room.revealRetryCount += 1;
    room.timer = setTimeout(() => {
      void timedReveal(io, room).catch((error) => {
        console.error(`Timed reveal retry failed for room ${room.roomCode}:`, error);
      });
    }, 2_000);
    room.timer.unref?.();
  }
}

async function revealQuestion(io, room) {
  if (room.status !== 'question') return { error: 'Сейчас нет активного вопроса' };
  if (room.transitioning) return { error: 'Результаты уже сохраняются' };
  room.transitioning = true;

  try {
    return await commitReveal(io, room);
  } finally {
    // A programming error or a failed DB call must never leave the room locked.
    room.transitioning = false;
  }
}

async function commitReveal(io, room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  const question = room.currentQuestion;
  const nextScores = new Map(
    [...room.participants.values()].map((participant) => [
      participant.id,
      participant.score + (room.answers.get(participant.id)?.score || 0),
    ])
  );
  const writes = [];

  for (const [participantId, answer] of room.answers.entries()) {
    writes.push(
      prisma.participantAnswer.upsert({
        where: {
          sessionId_questionId_participantId: {
            sessionId: room.sessionId,
            questionId: question.id,
            participantId,
          },
        },
        create: {
          sessionId: room.sessionId,
          questionId: question.id,
          participantId,
          selectedOptionIds: JSON.stringify(answer.optionIds),
          isCorrect: answer.correct,
          scoreAwarded: answer.score,
        },
        update: {
          selectedOptionIds: JSON.stringify(answer.optionIds),
          isCorrect: answer.correct,
          scoreAwarded: answer.score,
          answeredAt: new Date(),
        },
      })
    );
  }
  for (const [participantId, score] of nextScores.entries()) {
    writes.push(
      prisma.sessionParticipant.update({ where: { id: participantId }, data: { score } })
    );
  }

  try {
    await prisma.$transaction(writes);
  } catch (error) {
    console.error(`Could not persist reveal for room ${room.roomCode}:`, error);
    const message = 'Не удалось сохранить результаты. Ведущий может повторить операцию.';
    io.to(room.roomCode).emit('game:error', { message, recoverable: true });
    return { error: message };
  }

  for (const participant of room.participants.values()) {
    participant.score = nextScores.get(participant.id);
  }
  room.status = 'reveal';

  const correctOptionIds = question.options
    .filter((option) => option.isCorrect)
    .map((option) => option.id);
  const revealPayload = {
    questionId: question.id,
    correctOptionIds,
    leaderboard: leaderboard(room),
    isLast: room.currentIndex + 1 >= room.quiz.questions.length,
  };
  room.lastReveal = revealPayload;
  io.to(room.roomCode).emit('question:reveal', revealPayload);

  for (const [participantId, answer] of room.answers.entries()) {
    const participant = room.participants.get(participantId);
    if (participant?.connected && participant.socketId) {
      io.to(participant.socketId).emit('question:result', {
        correct: answer.correct,
        scoreAwarded: answer.score,
        totalScore: participant.score,
      });
    }
  }
  return { ok: true };
}

async function finishQuiz(io, room) {
  if (room.transitioning) return { error: 'Предыдущая операция ещё выполняется' };
  room.transitioning = true;
  try {
    await prisma.quizSession.update({
      where: { id: room.sessionId },
      data: { status: 'finished', finishedAt: new Date() },
    });
  } catch (error) {
    console.error(`Could not finish room ${room.roomCode}:`, error);
    const message = 'Не удалось сохранить завершение квиза. Повторите операцию.';
    io.to(room.roomCode).emit('game:error', { message, recoverable: true });
    return { error: message };
  } finally {
    room.transitioning = false;
  }

  if (room.timer) clearTimeout(room.timer);
  room.status = 'finished';
  io.to(room.roomCode).emit('quiz:finish', { leaderboard: leaderboard(room) });
  room.cleanupTimer = setTimeout(() => liveRooms.delete(room.roomCode), 60_000);
  room.cleanupTimer.unref?.();
  return { ok: true };
}

export async function shutdownLiveRooms(io) {
  const activeSessionIds = [];
  for (const room of liveRooms.values()) {
    if (room.timer) clearTimeout(room.timer);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    io.to(room.roomCode).emit('server:shutdown', {
      message: 'Сервер перезапускается. Активная игра завершена.',
    });
    if (room.status !== 'finished' && room.status !== 'lobby') {
      activeSessionIds.push(room.sessionId);
    }
  }
  if (activeSessionIds.length > 0) {
    await prisma.quizSession.updateMany({
      where: { id: { in: activeSessionIds }, status: 'active' },
      data: { status: 'finished', finishedAt: new Date() },
    });
  }
  io.disconnectSockets(true);
  liveRooms.clear();
}
