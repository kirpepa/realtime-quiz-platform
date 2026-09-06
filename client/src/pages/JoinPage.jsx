import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function JoinPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') || '');
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user?.nickname) setNickname(user.nickname);
  }, [user]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const cleanCode = code.trim().toUpperCase();
    const cleanNick = nickname.trim();
    if (!cleanNick) {
      setError('Введите имя');
      return;
    }
    setBusy(true);
    try {
      // Validate the room exists and is joinable before opening the socket.
      const { session } = await api(`/api/sessions/room/${cleanCode}`);
      if (session.status === 'finished') {
        throw new Error('Этот квиз уже завершён');
      }
      navigate('/play', { state: { code: cleanCode, nickname: cleanNick } });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md animate-fade-in-up py-6">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-2xl shadow-card">
          🎮
        </div>
        <h1 className="text-2xl font-bold">Присоединиться к квизу</h1>
        <p className="mt-1.5 text-sm text-muted">
          Введите код комнаты от ведущего и своё имя
        </p>
      </div>
      <div className="card">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Код комнаты</label>
            <input
              className="input text-center text-3xl font-extrabold uppercase tracking-[0.4em] placeholder:tracking-normal placeholder:text-xl"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={6}
              placeholder="ABC123"
              required
            />
          </div>
          <div>
            <label className="label">Ваше имя</label>
            <input
              className="input"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={40}
              placeholder="Например, Аня"
              required
            />
          </div>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
          <button type="submit" className="btn-primary w-full text-base" disabled={busy}>
            {busy ? 'Проверяем…' : 'Войти в комнату'}
          </button>
        </form>
        {!user && (
          <p className="mt-4 text-center text-xs leading-relaxed text-muted">
            Можно играть без регистрации. История игр сохраняется только у
            зарегистрированных участников.
          </p>
        )}
      </div>
    </div>
  );
}
