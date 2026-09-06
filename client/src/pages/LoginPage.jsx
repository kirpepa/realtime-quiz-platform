import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Logo from '../components/Logo.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
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
        <p className="mt-3 text-sm text-muted">Войдите, чтобы создавать и вести квизы</p>
      </div>
      <div className="card">
        <h1 className="mb-5 text-xl font-bold">Вход в аккаунт</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Пароль</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={72}
              required
            />
          </div>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Входим…' : 'Войти'}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-muted">
          Нет аккаунта?{' '}
          <Link to="/register" className="font-semibold text-brand-600 hover:text-brand-700">
            Зарегистрироваться
          </Link>
        </p>
      </div>
    </div>
  );
}
