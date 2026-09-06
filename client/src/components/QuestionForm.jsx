import { useState } from 'react';
import { api, assetUrl } from '../api/client.js';

const emptyOption = () => ({ text: '', isCorrect: false });

// Add/edit form for a single quiz question. `question` is null when adding.
export default function QuestionForm({ quizId, question, onSaved, onCancel }) {
  const [type, setType] = useState(question?.type || 'text');
  const [answerType, setAnswerType] = useState(question?.answerType || 'single');
  const [text, setText] = useState(question?.text || '');
  const [imageUrl, setImageUrl] = useState(question?.imageUrl || '');
  const [timeLimit, setTimeLimit] = useState(question?.timeLimit || '');
  const [options, setOptions] = useState(
    question?.options?.map((o) => ({ text: o.text, isCorrect: o.isCorrect })) || [
      emptyOption(),
      emptyOption(),
    ]
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  function setOption(i, patch) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  // Radio semantics for single-choice: selecting one clears the others.
  function toggleCorrect(i) {
    if (answerType === 'single') {
      setOptions((prev) => prev.map((o, idx) => ({ ...o, isCorrect: idx === i })));
    } else {
      setOption(i, { isCorrect: !options[i].isCorrect });
    }
  }

  // Switching to single-choice must leave at most one correct option, otherwise
  // the (now radio) inputs render several as checked and the server rejects it.
  function changeAnswerType(next) {
    setAnswerType(next);
    if (next === 'single') {
      const firstCorrect = options.findIndex((o) => o.isCorrect);
      setOptions((prev) => prev.map((o, idx) => ({ ...o, isCorrect: idx === firstCorrect })));
    }
  }

  function addOption() {
    if (options.length >= 6) return;
    setOptions([...options, emptyOption()]);
  }

  function removeOption(i) {
    if (options.length <= 2) return;
    setOptions(options.filter((_, idx) => idx !== i));
  }

  async function handleImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      setError('Выберите PNG, JPEG, WEBP или GIF');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Изображение должно быть не больше 5 МБ');
      e.target.value = '';
      return;
    }
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('image', file);
      const data = await api('/api/quizzes/upload', {
        method: 'POST',
        body: form,
        isForm: true,
      });
      setImageUrl(data.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (type === 'image' && !imageUrl) {
      setError('Загрузите изображение для этого вопроса');
      return;
    }
    setBusy(true);
    const payload = {
      type,
      answerType,
      text,
      imageUrl: type === 'image' ? imageUrl : null,
      timeLimit: timeLimit ? Number(timeLimit) : null,
      options,
    };
    try {
      if (question) {
        await api(`/api/quizzes/${quizId}/questions/${question.id}`, {
          method: 'PUT',
          body: payload,
        });
      } else {
        await api(`/api/quizzes/${quizId}/questions`, { method: 'POST', body: payload });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border-2 border-brand-200 bg-brand-50/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Тип вопроса</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="text">Текстовый</option>
            <option value="image">С изображением</option>
          </select>
        </div>
        <div>
          <label className="label">Тип ответа</label>
          <select
            className="input"
            value={answerType}
            onChange={(e) => changeAnswerType(e.target.value)}
          >
            <option value="single">Одиночный выбор</option>
            <option value="multiple">Множественный выбор</option>
          </select>
        </div>
      </div>

      <div>
        <label className="label">Текст вопроса</label>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} required />
      </div>

      {type === 'image' && (
        <div>
          <label className="label">Изображение</label>
          <input type="file" accept="image/*" onChange={handleImage} className="text-sm" />
          {uploading && <p className="text-xs text-slate-500">Загрузка…</p>}
          {imageUrl && (
            <img
              src={assetUrl(imageUrl)}
              alt="Превью"
              className="mt-2 max-h-40 rounded-lg border border-slate-200"
            />
          )}
        </div>
      )}

      <div>
        <label className="label">
          Варианты ответа{' '}
          <span className="font-normal text-slate-400">
            (отметьте правильные, {answerType === 'single' ? 'один' : 'один или несколько'})
          </span>
        </label>
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type={answerType === 'single' ? 'radio' : 'checkbox'}
                name={answerType === 'single' ? 'correct-option' : undefined}
                checked={o.isCorrect}
                onChange={() => toggleCorrect(i)}
                className="h-4 w-4 accent-brand-600"
              />
              <input
                className="input flex-1"
                placeholder={`Вариант ${i + 1}`}
                value={o.text}
                onChange={(e) => setOption(i, { text: e.target.value })}
                required
              />
              <button
                type="button"
                className="text-slate-400 hover:text-red-600 disabled:opacity-30"
                onClick={() => removeOption(i)}
                disabled={options.length <= 2}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {options.length < 6 && (
          <button type="button" onClick={addOption} className="mt-2 text-sm font-medium text-brand-600">
            + Добавить вариант
          </button>
        )}
      </div>

      <div>
        <label className="label">
          Время на вопрос, сек <span className="font-normal text-slate-400">(пусто = по умолчанию)</span>
        </label>
        <input
          type="number"
          min="5"
          max="300"
          className="input w-40"
          value={timeLimit}
          onChange={(e) => setTimeLimit(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy || uploading}>
          {busy ? 'Сохраняем…' : 'Сохранить вопрос'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
