import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, assetUrl } from '../api/client.js';
import QuestionForm from '../components/QuestionForm.jsx';

export default function QuizEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState(null);
  const [error, setError] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [editingId, setEditingId] = useState(null); // question id or 'new'

  async function load() {
    try {
      const data = await api(`/api/quizzes/${id}`);
      setQuiz(data.quiz);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function saveSettings(e) {
    e.preventDefault();
    setError('');
    try {
      const { quiz: updated } = await api(`/api/quizzes/${id}`, {
        method: 'PUT',
        body: {
          title: quiz.title,
          description: quiz.description,
          category: quiz.category,
          defaultTimePerQuestion: Number(quiz.defaultTimePerQuestion),
          allowAnswerChange: quiz.allowAnswerChange,
          speedBonus: quiz.speedBonus,
        },
      });
      setQuiz(updated);
      setSavedNote('Настройки сохранены');
      setTimeout(() => setSavedNote(''), 2000);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteQuestion(qid) {
    if (!confirm('Удалить вопрос?')) return;
    setError('');
    try {
      await api(`/api/quizzes/${id}/questions/${qid}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function move(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= quiz.questions.length) return;
    const order = quiz.questions.map((q) => q.id);
    [order[index], order[target]] = [order[target], order[index]];
    setError('');
    try {
      await api(`/api/quizzes/${id}/questions-order`, { method: 'PUT', body: { order } });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function launch() {
    try {
      const { session } = await api('/api/sessions', {
        method: 'POST',
        body: { quizId: id },
      });
      navigate(`/host/${session.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!quiz) {
    return error ? (
      <p className="text-red-600">{error}</p>
    ) : (
      <p className="text-slate-500">Загрузка…</p>
    );
  }

  const set = (k) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setQuiz({ ...quiz, [k]: val });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/dashboard" className="text-sm text-brand-600">
          ← К списку квизов
        </Link>
        <button
          className="btn-primary"
          onClick={launch}
          disabled={quiz.questions.length === 0}
          title={quiz.questions.length === 0 ? 'Добавьте хотя бы один вопрос' : ''}
        >
          ▶ Запустить квиз
        </button>
      </div>

      {/* Settings */}
      <form onSubmit={saveSettings} className="card space-y-4">
        <h1 className="text-xl font-bold">Настройки квиза</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Название</label>
            <input className="input" value={quiz.title} onChange={set('title')} required />
          </div>
          <div>
            <label className="label">Категория</label>
            <input className="input" value={quiz.category} onChange={set('category')} />
          </div>
        </div>
        <div>
          <label className="label">Описание</label>
          <textarea className="input" rows={2} value={quiz.description} onChange={set('description')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Время на вопрос по умолчанию, сек</label>
            <input
              type="number"
              min="5"
              max="300"
              className="input"
              value={quiz.defaultTimePerQuestion}
              onChange={set('defaultTimePerQuestion')}
            />
          </div>
          <label className="flex items-center gap-2 sm:mt-6">
            <input
              type="checkbox"
              checked={quiz.allowAnswerChange}
              onChange={set('allowAnswerChange')}
              className="h-4 w-4 accent-brand-600"
            />
            <span className="text-sm">Разрешить смену ответа</span>
          </label>
          <label className="flex items-center gap-2 sm:mt-6">
            <input
              type="checkbox"
              checked={quiz.speedBonus}
              onChange={set('speedBonus')}
              className="h-4 w-4 accent-brand-600"
            />
            <span className="text-sm">Бонус за скорость</span>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">
            Сохранить настройки
          </button>
          {savedNote && <span className="text-sm text-green-600">{savedNote}</span>}
        </div>
      </form>

      {/* Questions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Вопросы ({quiz.questions.length})</h2>
          {editingId !== 'new' && (
            <button className="btn-secondary" onClick={() => setEditingId('new')}>
              + Добавить вопрос
            </button>
          )}
        </div>

        {editingId === 'new' && (
          <QuestionForm
            quizId={id}
            question={null}
            onSaved={() => {
              setEditingId(null);
              load();
            }}
            onCancel={() => setEditingId(null)}
          />
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {quiz.questions.length === 0 && editingId !== 'new' && (
          <div className="card text-center text-slate-500">Пока нет вопросов.</div>
        )}

        {quiz.questions.map((q, i) =>
          editingId === q.id ? (
            <QuestionForm
              key={q.id}
              quizId={id}
              question={q}
              onSaved={() => {
                setEditingId(null);
                load();
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div key={q.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>#{i + 1}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">
                      {q.type === 'image' ? 'изображение' : 'текст'}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">
                      {q.answerType === 'multiple' ? 'множественный' : 'одиночный'}
                    </span>
                  </div>
                  <h3 className="mt-1 font-semibold">{q.text}</h3>
                  {q.imageUrl && (
                    <img
                      src={assetUrl(q.imageUrl)}
                      alt=""
                      className="mt-2 max-h-32 rounded-lg border border-slate-200"
                    />
                  )}
                  <ul className="mt-2 space-y-1 text-sm">
                    {q.options.map((o) => (
                      <li
                        key={o.id}
                        className={o.isCorrect ? 'font-medium text-green-700' : 'text-slate-600'}
                      >
                        {o.isCorrect ? '✓' : '•'} {o.text}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col gap-1">
                  <button className="btn-secondary px-2 py-1" onClick={() => move(i, -1)} disabled={i === 0}>
                    ↑
                  </button>
                  <button
                    className="btn-secondary px-2 py-1"
                    onClick={() => move(i, 1)}
                    disabled={i === quiz.questions.length - 1}
                  >
                    ↓
                  </button>
                  <button className="btn-secondary px-2 py-1" onClick={() => setEditingId(q.id)}>
                    ✎
                  </button>
                  <button className="btn-secondary px-2 py-1" onClick={() => deleteQuestion(q.id)}>
                    🗑
                  </button>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
