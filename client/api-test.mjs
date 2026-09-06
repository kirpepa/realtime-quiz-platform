// Supplementary API test: quiz/question CRUD, validation, image upload,
// participant registration & history. Complements the realtime e2e test.
const API = 'http://localhost:4000';
const log = (...a) => console.log('•', ...a);
const fail = (m) => { console.error('✗ FAIL:', m); process.exit(1); };

async function j(path, opts = {}, token) {
  const headers = { ...(opts.headers || {}) };
  if (!opts.raw) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.raw ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function main() {
  // --- organizer registers ---
  const orgEmail = `org_${Date.now()}@t.dev`;
  let r = await j('/api/auth/register', {
    method: 'POST',
    body: { email: orgEmail, password: 'secret123', nickname: 'Орг', role: 'organizer' },
  });
  if (r.status !== 201 || r.data.user.role !== 'organizer') fail('organizer register');
  const orgToken = r.data.accessToken;
  log('organizer registered with role=organizer');

  // --- participant registers ---
  const partEmail = `part_${Date.now()}@t.dev`;
  r = await j('/api/auth/register', {
    method: 'POST',
    body: { email: partEmail, password: 'secret123', nickname: 'Игрок', role: 'participant' },
  });
  if (r.status !== 201 || r.data.user.role !== 'participant') fail('participant register');
  const partToken = r.data.accessToken;
  log('participant registered with role=participant');

  // --- duplicate email rejected ---
  r = await j('/api/auth/register', {
    method: 'POST',
    body: { email: orgEmail, password: 'secret123', nickname: 'X', role: 'organizer' },
  });
  if (r.status !== 409) fail('duplicate email should be 409, got ' + r.status);
  log('duplicate email rejected (409)');

  // --- participant cannot create a quiz (role guard) ---
  r = await j('/api/quizzes', { method: 'POST', body: { title: 'X' } }, partToken);
  if (r.status !== 403) fail('participant creating quiz should be 403, got ' + r.status);
  log('role guard: participant blocked from creating quiz (403)');

  // --- create quiz with category + rules ---
  r = await j('/api/quizzes', {
    method: 'POST',
    body: {
      title: 'Тест-квиз',
      category: 'История',
      defaultTimePerQuestion: 25,
      allowAnswerChange: true,
      speedBonus: false,
    },
  }, orgToken);
  if (r.status !== 201) fail('create quiz');
  const quizId = r.data.quiz.id;
  if (r.data.quiz.category !== 'История' || r.data.quiz.defaultTimePerQuestion !== 25)
    fail('quiz settings not saved');
  if (r.data.quiz.allowAnswerChange !== true || r.data.quiz.speedBonus !== false)
    fail('quiz rules not saved');
  log('quiz created with category + rules persisted');

  // --- image upload ---
  const pngB64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const bytes = Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0));
  const fd = new FormData();
  fd.append('image', new Blob([bytes], { type: 'image/png' }), 'p.png');
  const up = await fetch(`${API}/api/quizzes/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${orgToken}` },
    body: fd,
  });
  const upData = await up.json();
  if (up.status !== 201 || !upData.url?.startsWith('/uploads/')) fail('image upload');
  // verify the file is served
  const served = await fetch(`${API}${upData.url}`);
  if (served.status !== 200) fail('uploaded image not served');
  log('image upload works and file is served');

  // A forged browser MIME must not turn arbitrary bytes into a public file.
  const forged = new FormData();
  forged.append('image', new Blob(['not really a png'], { type: 'image/png' }), 'fake.png');
  const forgedUpload = await fetch(`${API}/api/quizzes/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${orgToken}` },
    body: forged,
  });
  if (forgedUpload.status !== 415) fail('forged image MIME should be rejected with 415');
  log('upload signature validation rejects forged MIME (415)');

  // --- add image + multiple-choice question ---
  r = await j(`/api/quizzes/${quizId}/questions`, {
    method: 'POST',
    body: {
      type: 'image',
      answerType: 'multiple',
      text: 'Выберите тёплые цвета',
      imageUrl: upData.url,
      options: [
        { text: 'Красный', isCorrect: true },
        { text: 'Синий', isCorrect: false },
        { text: 'Оранжевый', isCorrect: true },
        { text: 'Зелёный', isCorrect: false },
      ],
    },
  }, orgToken);
  if (r.status !== 201) fail('add multiple-choice image question: ' + JSON.stringify(r.data));
  log('image + multiple-choice question added');

  // --- validation: single choice with 2 correct must fail ---
  r = await j(`/api/quizzes/${quizId}/questions`, {
    method: 'POST',
    body: {
      type: 'text', answerType: 'single', text: 'Bad',
      options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }],
    },
  }, orgToken);
  if (r.status !== 400) fail('single-choice with 2 correct should be 400, got ' + r.status);
  log('validation: single-choice with 2 correct rejected');

  // --- validation: only 1 option must fail (need 2-6) ---
  r = await j(`/api/quizzes/${quizId}/questions`, {
    method: 'POST',
    body: { type: 'text', answerType: 'single', text: 'Bad', options: [{ text: 'a', isCorrect: true }] },
  }, orgToken);
  if (r.status !== 400) fail('single option should be 400, got ' + r.status);
  log('validation: <2 options rejected');

  // --- validation: no correct answer must fail ---
  r = await j(`/api/quizzes/${quizId}/questions`, {
    method: 'POST',
    body: {
      type: 'text', answerType: 'single', text: 'Bad',
      options: [{ text: 'a', isCorrect: false }, { text: 'b', isCorrect: false }],
    },
  }, orgToken);
  if (r.status !== 400) fail('no correct answer should be 400, got ' + r.status);
  log('validation: no correct option rejected');

  // --- validation: multiple choice with only 1 correct must fail ---
  r = await j(`/api/quizzes/${quizId}/questions`, {
    method: 'POST',
    body: {
      type: 'text', answerType: 'multiple', text: 'Bad',
      options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: false }],
    },
  }, orgToken);
  if (r.status !== 400) fail('multiple with 1 correct should be 400, got ' + r.status);
  log('validation: multiple-choice with <2 correct rejected');

  // --- validation: image type without imageUrl must fail ---
  r = await j(`/api/quizzes/${quizId}/questions`, {
    method: 'POST',
    body: {
      type: 'image', answerType: 'single', text: 'No image',
      options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: false }],
    },
  }, orgToken);
  if (r.status !== 400) fail('image question without image should be 400, got ' + r.status);
  log('validation: image question without image rejected');

  // --- other organizer cannot access this quiz ---
  const org2 = await j('/api/auth/register', {
    method: 'POST',
    body: { email: `org2_${Date.now()}@t.dev`, password: 'secret123', nickname: 'Орг2', role: 'organizer' },
  });
  r = await j(`/api/quizzes/${quizId}`, {}, org2.data.accessToken);
  if (r.status !== 403) fail("other organizer accessing quiz should be 403, got " + r.status);
  log('ownership guard: foreign organizer blocked (403)');

  // --- participant history endpoint works (empty is fine) ---
  r = await j('/api/me/participations', {}, partToken);
  if (r.status !== 200 || !Array.isArray(r.data.participations)) fail('participant history');
  log('participant history endpoint OK');

  // --- organizer session history endpoint works ---
  r = await j('/api/me/sessions', {}, orgToken);
  if (r.status !== 200 || !Array.isArray(r.data.sessions)) fail('organizer history');
  log('organizer history endpoint OK');

  // --- cannot start a quiz with 0 questions ---
  const empty = await j('/api/quizzes', { method: 'POST', body: { title: 'Пустой' } }, orgToken);
  r = await j('/api/sessions', { method: 'POST', body: { quizId: empty.data.quiz.id } }, orgToken);
  if (r.status !== 400) fail('starting empty quiz should be 400, got ' + r.status);
  log('cannot start quiz without questions (400)');

  console.log('\n✓ ALL API CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => fail(e.message));
