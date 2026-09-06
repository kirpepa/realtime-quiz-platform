import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { getSocket, emitAck } from '../socket.js';
import { assetUrl, getSocketAccessToken } from '../api/client.js';
import Timer from '../components/Timer.jsx';
import Leaderboard from '../components/Leaderboard.jsx';

export default function PlayPage() {
  const location = useLocation();
  const navigate = useNavigate();
  let storedJoin = null;
  try {
    storedJoin = JSON.parse(sessionStorage.getItem('active_quiz_join'));
  } catch {
    sessionStorage.removeItem('active_quiz_join');
  }
  const code = location.state?.code || storedJoin?.code;
  const nickname = location.state?.nickname || storedJoin?.nickname;

  const [phase, setPhase] = useState('joining'); // joining | waiting | question | answered | reveal | finished
  const [error, setError] = useState('');
  const [fatalError, setFatalError] = useState('');
  const [connectionNote, setConnectionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [quizTitle, setQuizTitle] = useState('');
  const [question, setQuestion] = useState(null);
  const [selected, setSelected] = useState([]);
  const [result, setResult] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const participantIdRef = useRef(null);
  const rejoinTokenRef = useRef(null);
  const joiningRef = useRef(false);

  useEffect(() => {
    if (!code || !nickname) {
      navigate('/join');
      return;
    }
    sessionStorage.setItem('active_quiz_join', JSON.stringify({ code, nickname }));
    const socket = getSocket();
    let active = true;
    const idKey = `participant_${code}`;
    const tokenKey = `rejoin_${code}`;

    async function join() {
      // Serialize joins: without this guard, the initial call plus the
      // `connect` event (and React StrictMode's double-mount) can fire several
      // joins before a participantId is persisted — each creating a duplicate.
      if (joiningRef.current) return;
      joiningRef.current = true;
      try {
        const accessToken = await getSocketAccessToken();
        if (!active) return;
        const res = await emitAck('room:join', {
          roomCode: code,
          nickname,
          token: accessToken,
          participantId: participantIdRef.current || localStorage.getItem(idKey),
          rejoinToken: rejoinTokenRef.current || localStorage.getItem(tokenKey),
        });
        if (!active) return;
        if (res.error) {
          if (participantIdRef.current) setConnectionNote(res.error);
          else setFatalError(res.error);
          return;
        }
        setFatalError('');
        setConnectionNote('');
        setError('');
        participantIdRef.current = res.participantId;
        rejoinTokenRef.current = res.rejoinToken;
        localStorage.setItem(idKey, res.participantId);
        if (res.rejoinToken) localStorage.setItem(tokenKey, res.rejoinToken);
        setQuizTitle(res.quizTitle);
        setLeaderboard(res.leaderboard || []);
        setSelected(res.ownAnswer?.optionIds || []);
        if (res.status === 'reveal') {
          // Reconnected mid-reveal: restore the correct answers + leaderboard.
          if (res.currentQuestion) setQuestion(res.currentQuestion);
          setReveal(res.reveal || null);
          if (res.ownAnswer?.correct !== undefined) {
            setResult({
              correct: res.ownAnswer.correct,
              scoreAwarded: res.ownAnswer.scoreAwarded,
              totalScore: res.ownAnswer.totalScore,
            });
          } else {
            setResult(null);
          }
          setPhase('reveal');
        } else if (res.currentQuestion) {
          setQuestion(res.currentQuestion);
          setResult(null);
          setReveal(null);
          setPhase(res.ownAnswer ? 'answered' : 'question');
        } else if (res.status === 'finished') {
          setPhase('finished');
        } else {
          setPhase('waiting');
        }
      } finally {
        joiningRef.current = false;
      }
    }

    const onShow = (q) => {
      setError('');
      setQuestion(q);
      setSelected([]);
      setResult(null);
      setReveal(null);
      setPhase('question');
    };
    const onAck = ({ optionIds }) => {
      setSelected(optionIds || []);
      setPhase('answered');
    };
    const onResult = (data) => setResult(data);
    const onReveal = (data) => {
      setReveal(data);
      setLeaderboard(data.leaderboard || []);
      setPhase('reveal');
    };
    const onFinish = (data) => {
      setLeaderboard(data.leaderboard || []);
      setPhase('finished');
      sessionStorage.removeItem('active_quiz_join');
    };
    const onGameError = ({ message }) => setError(message || 'Ошибка сохранения игры');
    const onReplaced = ({ message }) => setFatalError(message || 'Сессия открыта в другой вкладке');
    const onShutdown = ({ message }) => setFatalError(message || 'Сервер перезапускается');
    const onDisconnect = () => setConnectionNote('Соединение потеряно, переподключаемся…');

    // The same path handles both the first connection and later reconnects;
    // joiningRef serializes overlapping React/socket lifecycle callbacks.
    const onReconnect = () => join();

    socket.on('question:show', onShow);
    socket.on('question:answered_ack', onAck);
    socket.on('question:result', onResult);
    socket.on('question:reveal', onReveal);
    socket.on('quiz:finish', onFinish);
    socket.on('game:error', onGameError);
    socket.on('session:replaced', onReplaced);
    socket.on('server:shutdown', onShutdown);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onReconnect);
    if (socket.connected) join();

    return () => {
      active = false;
      joiningRef.current = false;
      if (socket.connected) {
        socket.emit('room:leave', {
          role: 'participant',
          roomCode: code,
          participantId: participantIdRef.current,
        });
      }
      socket.off('question:show', onShow);
      socket.off('question:answered_ack', onAck);
      socket.off('question:result', onResult);
      socket.off('question:reveal', onReveal);
      socket.off('quiz:finish', onFinish);
      socket.off('game:error', onGameError);
      socket.off('session:replaced', onReplaced);
      socket.off('server:shutdown', onShutdown);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onReconnect);
    };
  }, [code, nickname, navigate]);

  function toggleOption(id) {
    if (!question) return;
    if (question.answerType === 'single') {
      setSelected([id]);
    } else {
      setSelected((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    }
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await emitAck('question:answer', { optionIds: selected });
      if (res.error) setError(res.error);
      // Success path is confirmed by the question:answered_ack event.
    } finally {
      setSubmitting(false);
    }
  }

  const myEntry = leaderboard.find((e) => e.participantId === participantIdRef.current);
  const myRank = myEntry ? leaderboard.indexOf(myEntry) + 1 : null;

  if (fatalError) {
    return (
      <div className="mx-auto max-w-md card text-center">
        <p className="text-red-600">{fatalError}</p>
        <Link to="/join" className="btn-secondary mt-4">
          ← Назад
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {connectionNote && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {connectionNote}
        </p>
      )}
      {error && phase !== 'question' && phase !== 'answered' && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{quizTitle || 'Квиз'}</h1>
          <p className="text-sm text-slate-500">
            Вы: <b>{nickname}</b> · комната {code}
          </p>
        </div>
        {myEntry && (
          <div className="text-right text-sm">
            <p className="font-bold text-brand-700">{myEntry.score} б.</p>
            <p className="text-slate-400">место {myRank}</p>
          </div>
        )}
      </div>

      {phase === 'joining' && <div className="card text-center text-slate-500">Подключаемся…</div>}

      {phase === 'waiting' && (
        <div className="card text-center">
          <div className="mb-3 text-4xl">⏳</div>
          <h2 className="text-lg font-semibold">Вы в комнате!</h2>
          <p className="text-sm text-slate-500">Ждём, пока организатор начнёт квиз.</p>
        </div>
      )}

      {(phase === 'question' || phase === 'answered') && question && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              Вопрос {question.index + 1} из {question.total}
            </span>
            <span>{question.answerType === 'multiple' ? 'неск. ответов' : 'один ответ'}</span>
          </div>
          <Timer
            endsAt={question.endsAt}
            serverNow={question.serverNow}
            timeLimitMs={question.timeLimitMs}
          />
          <h2 className="text-xl font-bold">{question.text}</h2>
          {question.imageUrl && (
            <img
              src={assetUrl(question.imageUrl)}
              alt=""
              className="max-h-56 w-full rounded-lg border border-slate-200 object-contain"
            />
          )}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {question.options.map((o, idx) => {
              const isSelected = selected.includes(o.id);
              return (
                <button
                  key={o.id}
                  onClick={() => toggleOption(o.id)}
                  disabled={phase === 'answered'}
                  className={`group flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition-all disabled:opacity-60 ${
                    isSelected
                      ? 'border-brand-500 bg-brand-50 shadow-sm'
                      : 'border-line bg-white hover:border-brand-300 hover:bg-brand-50/40'
                  }`}
                >
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-bold transition ${
                      isSelected
                        ? 'bg-brand-500 text-white'
                        : 'bg-canvas text-muted group-hover:bg-brand-100 group-hover:text-brand-600'
                    }`}
                  >
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className={`text-[15px] ${isSelected ? 'font-semibold text-brand-700' : 'font-medium text-ink'}`}>
                    {o.text}
                  </span>
                </button>
              );
            })}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {phase === 'question' ? (
            <button
              className="btn-primary w-full"
              onClick={submit}
              disabled={selected.length === 0 || submitting}
            >
              {submitting ? 'Отправляем…' : 'Ответить'}
            </button>
          ) : (
            <p className="text-center text-sm font-medium text-green-600">
              ✓ Ответ принят. Ждём остальных…
            </p>
          )}
        </div>
      )}

      {phase === 'reveal' && (
        <div className="space-y-4">
          <div
            className={`card text-center ${
              result?.correct ? 'bg-green-50' : result ? 'bg-red-50' : ''
            }`}
          >
            {result ? (
              <>
                <div className="text-4xl">{result.correct ? '✅' : '❌'}</div>
                <h2 className="mt-2 text-lg font-bold">
                  {result.correct ? 'Верно!' : 'Неверно'}
                </h2>
                <p className="text-sm text-slate-600">
                  +{result.scoreAwarded} баллов · всего {result.totalScore}
                </p>
              </>
            ) : (
              <p className="text-slate-500">Результаты вопроса</p>
            )}
          </div>
          {question && reveal && (
            <div className="card">
              <h2 className="mb-3 font-semibold">Правильный ответ</h2>
              <div className="grid gap-2">
                {question.options.map((o) => {
                  const isCorrect = reveal.correctOptionIds?.includes(o.id);
                  const chosen = selected.includes(o.id);
                  return (
                    <div
                      key={o.id}
                      className={`flex items-center justify-between rounded-xl border-2 px-4 py-2.5 text-[15px] ${
                        isCorrect
                          ? 'border-green-400 bg-green-50 font-medium text-green-800'
                          : 'border-line bg-white text-slate-500'
                      }`}
                    >
                      <span>
                        {isCorrect ? '✓ ' : ''}
                        {o.text}
                      </span>
                      {chosen && <span className="text-xs text-muted">ваш выбор</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="card">
            <h2 className="mb-3 font-semibold">Лидерборд</h2>
            <Leaderboard entries={leaderboard} highlightId={participantIdRef.current} />
          </div>
        </div>
      )}

      {phase === 'finished' && (
        <div className="card space-y-4 text-center">
          <div className="text-4xl">🏆</div>
          <h2 className="text-xl font-bold">Квиз завершён!</h2>
          {myRank && (
            <p className="text-lg">
              Ваше место: <b className="text-brand-700">{myRank}</b> из {leaderboard.length} ·{' '}
              {myEntry?.score} баллов
            </p>
          )}
          <div className="mx-auto max-w-md text-left">
            <Leaderboard entries={leaderboard} highlightId={participantIdRef.current} />
          </div>
          <Link to="/" className="btn-primary">
            На главную
          </Link>
        </div>
      )}
    </div>
  );
}
