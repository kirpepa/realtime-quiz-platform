import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getSocket, emitAck } from '../socket.js';
import { assetUrl, getSocketAccessToken } from '../api/client.js';
import Timer from '../components/Timer.jsx';
import Leaderboard from '../components/Leaderboard.jsx';

export default function HostSessionPage() {
  const { sessionId } = useParams();
  const [phase, setPhase] = useState('connecting'); // connecting | lobby | question | reveal | finished
  const [fatalError, setFatalError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [quizTitle, setQuizTitle] = useState('');
  const [participants, setParticipants] = useState([]);
  const [question, setQuestion] = useState(null);
  const [progress, setProgress] = useState({ answered: 0, total: 0 });
  const [reveal, setReveal] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [actionBusy, setActionBusy] = useState(false);
  const openingRef = useRef(false);

  useEffect(() => {
    const socket = getSocket();
    let active = true;

    async function open() {
      if (openingRef.current) return;
      openingRef.current = true;
      const token = await getSocketAccessToken();
      if (!active) {
        openingRef.current = false;
        return;
      }
      if (!token) {
        setFatalError('Сессия авторизации истекла. Войдите снова.');
        openingRef.current = false;
        return;
      }
      const res = await emitAck('organizer:open', {
        sessionId,
        token,
      });
      openingRef.current = false;
      if (!active) return;
      if (res.error) {
        setFatalError(res.error);
        return;
      }
      setFatalError('');
      setOperationError('');
      setRoomCode(res.roomCode);
      setQuizTitle(res.quizTitle);
      setParticipants(res.participants || []);
      setLeaderboard(res.leaderboard || []);
      setProgress(res.progress || { answered: 0, total: 0 });
      if (res.currentQuestion) setQuestion(res.currentQuestion);
      if (res.status === 'reveal') {
        // Reconnected mid-reveal: restore the correct answers + leaderboard.
        setReveal(res.reveal || null);
        setPhase('reveal');
      } else if (res.currentQuestion) {
        setPhase('question');
      } else {
        setPhase(res.status === 'lobby' ? 'lobby' : res.status);
      }
    }

    const onParticipants = (list) => setParticipants(list);
    const onShow = (q) => {
      setOperationError('');
      setQuestion(q);
      setReveal(null);
      setProgress({ answered: 0, total: 0 });
      setPhase('question');
    };
    const onProgress = (p) => setProgress(p);
    const onReveal = (data) => {
      setReveal(data);
      setLeaderboard(data.leaderboard || []);
      setPhase('reveal');
    };
    const onFinish = (data) => {
      setLeaderboard(data.leaderboard || []);
      setPhase('finished');
    };
    const onGameError = ({ message }) => setOperationError(message || 'Ошибка сохранения игры');
    const onReplaced = ({ message }) => setFatalError(message || 'Сессия открыта в другой вкладке');
    const onShutdown = ({ message }) => setFatalError(message || 'Сервер перезапускается');

    socket.on('room:participants', onParticipants);
    socket.on('question:show', onShow);
    socket.on('question:progress', onProgress);
    socket.on('question:reveal', onReveal);
    socket.on('quiz:finish', onFinish);
    socket.on('game:error', onGameError);
    socket.on('session:replaced', onReplaced);
    socket.on('server:shutdown', onShutdown);
    socket.on('connect', open);
    if (socket.connected) open();

    return () => {
      active = false;
      openingRef.current = false;
      if (socket.connected) socket.emit('room:leave', { role: 'organizer', sessionId });
      socket.off('room:participants', onParticipants);
      socket.off('question:show', onShow);
      socket.off('question:progress', onProgress);
      socket.off('question:reveal', onReveal);
      socket.off('quiz:finish', onFinish);
      socket.off('game:error', onGameError);
      socket.off('session:replaced', onReplaced);
      socket.off('server:shutdown', onShutdown);
      socket.off('connect', open);
    };
  }, [sessionId]);

  async function start() {
    if (actionBusy) return;
    setActionBusy(true);
    setOperationError('');
    try {
      const res = await emitAck('quiz:start', {});
      if (res.error) setOperationError(res.error);
    } finally {
      setActionBusy(false);
    }
  }
  async function revealNow() {
    if (actionBusy) return;
    setActionBusy(true);
    setOperationError('');
    try {
      const res = await emitAck('quiz:reveal', {});
      if (res.error) setOperationError(res.error);
    } finally {
      setActionBusy(false);
    }
  }
  async function next() {
    if (actionBusy) return;
    setActionBusy(true);
    setOperationError('');
    try {
      const res = await emitAck('quiz:next', {});
      if (res.error) setOperationError(res.error);
    } finally {
      setActionBusy(false);
    }
  }

  if (fatalError) {
    return (
      <div className="card">
        <p className="text-red-600">{fatalError}</p>
        <Link to="/dashboard" className="btn-secondary mt-4">
          ← В кабинет
        </Link>
      </div>
    );
  }

  const joinUrl = `${window.location.origin}/join?code=${roomCode}`;
  const connectedCount = participants.filter((participant) => participant.connected).length;

  return (
    <div className="space-y-6">
      {operationError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{operationError}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{quizTitle}</h1>
          <p className="text-sm text-slate-500">Панель организатора</p>
        </div>
        <Link to="/dashboard" className="btn-secondary">
          Выйти в кабинет
        </Link>
      </div>

      {/* Room code — always visible while running */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-500 to-brand-700 p-6 text-white shadow-card sm:p-8">
        <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-white/70">
              Код комнаты
            </p>
            <p className="mt-1 text-6xl font-black tracking-[0.15em] tabular-nums">
              {roomCode || '…'}
            </p>
          </div>
          <div className="text-sm text-white/80">
            <p className="mb-1">Зайдите на сайт и введите код,</p>
            <p className="mb-1">или откройте ссылку:</p>
            <p className="font-semibold text-white">{joinUrl}</p>
          </div>
        </div>
      </div>

      {phase === 'lobby' && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Подключились: {connectedCount}
            </h2>
            <button
              className="btn-primary"
              onClick={start}
              disabled={connectedCount === 0 || actionBusy}
            >
              ▶ Начать квиз
            </button>
          </div>
          {connectedCount === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-brand-400 opacity-75" />
                <span className="inline-flex h-3 w-3 rounded-full bg-brand-500" />
              </span>
              <p className="text-sm text-muted">Ожидаем участников…</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {participants.map((p) => (
                <span
                  key={p.participantId}
                  className="inline-flex animate-pop-in items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-sm font-medium shadow-sm"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-500 text-[11px] font-bold text-white">
                    {p.nickname[0]?.toUpperCase()}
                  </span>
                  {p.nickname}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {phase === 'question' && question && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              Вопрос {question.index + 1} из {question.total}
            </span>
            <span>
              Ответили: {progress.answered} / {progress.total}
            </span>
          </div>
          <Timer
            endsAt={question.endsAt}
            serverNow={question.serverNow}
            timeLimitMs={question.timeLimitMs}
          />
          <h2 className="text-2xl font-bold">{question.text}</h2>
          {question.imageUrl && (
            <img
              src={assetUrl(question.imageUrl)}
              alt=""
              className="max-h-64 rounded-lg border border-slate-200"
            />
          )}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {question.options.map((o, idx) => (
              <div
                key={o.id}
                className="flex items-center gap-3 rounded-2xl border-2 border-line bg-white px-4 py-3.5"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-canvas text-sm font-bold text-muted">
                  {String.fromCharCode(65 + idx)}
                </span>
                <span className="text-[15px] font-medium">{o.text}</span>
              </div>
            ))}
          </div>
          <button className="btn-secondary" onClick={revealNow} disabled={actionBusy}>
            Показать ответ сейчас
          </button>
        </div>
      )}

      {phase === 'reveal' && reveal && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card space-y-3">
            <h2 className="text-lg font-semibold">Правильный ответ</h2>
            {question?.options.map((o) => {
              const correct = reveal.correctOptionIds.includes(o.id);
              return (
                <div
                  key={o.id}
                  className={`rounded-lg border px-4 py-3 ${
                    correct
                      ? 'border-green-400 bg-green-50 font-medium text-green-800'
                      : 'border-slate-200 bg-white text-slate-500'
                  }`}
                >
                  {correct ? '✓ ' : ''}
                  {o.text}
                </div>
              );
            })}
            <button className="btn-primary w-full" onClick={next} disabled={actionBusy}>
              {reveal.isLast ? '🏁 Завершить и показать итоги' : 'Следующий вопрос →'}
            </button>
          </div>
          <div className="card">
            <h2 className="mb-3 text-lg font-semibold">Лидерборд</h2>
            <Leaderboard entries={leaderboard} />
          </div>
        </div>
      )}

      {phase === 'finished' && (
        <div className="card space-y-4 text-center">
          <h2 className="text-2xl font-bold">🏆 Итоги квиза</h2>
          {leaderboard[0] && (
            <p className="text-lg">
              Победитель: <b className="text-brand-700">{leaderboard[0].nickname}</b> с{' '}
              {leaderboard[0].score} баллами!
            </p>
          )}
          <div className="mx-auto max-w-md text-left">
            <Leaderboard entries={leaderboard} />
          </div>
          <Link to="/dashboard" className="btn-primary">
            В кабинет
          </Link>
        </div>
      )}
    </div>
  );
}
