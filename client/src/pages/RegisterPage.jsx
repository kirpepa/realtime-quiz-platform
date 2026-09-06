import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Logo from '../components/Logo.jsx';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    nickname: '',
    email: '',
    password: '',
    role: 'organizer',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(form);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md animate-fade-in-up py-6">
      <div className="mb-6 flex flex-col items-center text-center">
        <Logo size="lg" />
        <p className="mt-3 text-sm text-muted">Создайте аккаунт за минуту</p>
      </div>
      <div className="card">
        <h1 className="mb-5 text-xl font-bold">Регистрация</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Никнейм</label>
            <input
              className="input"
              value={form.nickname}
              onChange={update('nickname')}
              maxLength={40}
              required
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" value={form.email} onChange={update('email')} required />
          </div>
          <div>
            <label className="label">Пароль (мин. 8 символов)</label>
            <input
              type="password"
              className="input"
              value={form.password}
              onChange={update('password')}
              minLength={8}
              maxLength={72}
              required
            />
          </div>
          <div>
            <label className="label">Роль</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'organizer', label: 'Организатор' },
                { value: 'participant', label: 'Участник' },
              ].map((r) => (
                <button
                  type="button"
                  key={r.value}
                  onClick={() => setForm({ ...form, role: r.value })}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    form.role === r.value
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Организатор создаёт квизы. Участник может присоединяться к комнатам
              (это можно делать и без аккаунта).
            </p>
          </div>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Создаём…' : 'Создать аккаунт'}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-muted">
          Уже есть аккаунт?{' '}
          <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">
            Войти
          </Link>
        </p>
      </div>
    </div>
  );
}
