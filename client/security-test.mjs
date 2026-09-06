// Verifies the participant-identity fixes:
//  1. A stranger who knows a victim's participantId cannot hijack it.
//  2. The real owner reconnects via participantId + rejoinToken.
//  3. An authenticated participant is de-duplicated per session (no new row).
import { io } from 'socket.io-client';

const API = 'http://localhost:4000';
const log = (...a) => console.log('•', ...a);
const fail = (m) => { console.error('✗ FAIL:', m); process.exit(1); };
const ack = (s, ev, p) => new Promise((r) => s.emit(ev, p, (x) => r(x || {})));
const conn = () => { const s = io(API, { transports: ['websocket'] }); return new Promise((r) => s.on('connect', () => r(s))); };
const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

async function login(email, password) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return r.json();
}
async function register(email, role) {
  const r = await fetch(`${API}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret123', nickname: email.split('@')[0], role }),
  });
  return r.json();
}

async function main() {
  const org = await login('demo@quiz.dev', 'password123');
  const quizzesRes = await fetch(`${API}/api/quizzes`, { headers: { Authorization: `Bearer ${org.accessToken}` } });
  const { quizzes } = await quizzesRes.json();
  const quiz = quizzes.find((q) => q._count.questions > 0);
  const sessRes = await fetch(`${API}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${org.accessToken}` },
    body: JSON.stringify({ quizId: quiz.id }),
  });
  const { session } = await sessRes.json();
  const orgSock = await conn();
  await ack(orgSock, 'organizer:open', { sessionId: session.id, token: org.accessToken });
  log('session opened, room', session.roomCode);

  // 1. Victim (guest) joins.
  const victim = await conn();
  const vj = await ack(victim, 'room:join', { roomCode: session.roomCode, nickname: 'Жертва' });
  if (!vj.participantId || !vj.rejoinToken) fail('join should return participantId + rejoinToken');
  log('victim joined with a rejoinToken');

  // 2. Attacker knows the participantId (it is broadcast) but not the token.
  const attacker = await conn();
  const aj = await ack(attacker, 'room:join', {
    roomCode: session.roomCode, nickname: 'Злоумышленник', participantId: vj.participantId,
  });
  if (aj.participantId === vj.participantId) fail('HIJACK: attacker took over victim participantId');
  log('hijack prevented: attacker got a fresh participantId');

  // 3. Real owner reconnects with the correct id + token → same participant.
  const victim2 = await conn();
  const victimReplaced = once(victim, 'session:replaced');
  const vr = await ack(victim2, 'room:join', {
    roomCode: session.roomCode, nickname: 'Жертва',
    participantId: vj.participantId, rejoinToken: vj.rejoinToken,
  });
  if (vr.participantId !== vj.participantId) fail('owner reconnect should reuse participantId');
  await victimReplaced;
  log('owner reconnect works via rejoinToken');

  // 4. Authenticated participant dedup: join twice with only the token (no id).
  const partEmail = `dedup_${Date.now()}_${session.roomCode}@t.dev`;
  const part = await register(partEmail, 'participant');
  const pc1 = await conn();
  const p1 = await ack(pc1, 'room:join', { roomCode: session.roomCode, nickname: 'Игрок', token: part.accessToken });
  const pc2 = await conn();
  const firstSocketReplaced = once(pc1, 'session:replaced');
  const p2 = await ack(pc2, 'room:join', { roomCode: session.roomCode, nickname: 'Игрок', token: part.accessToken });
  if (p1.participantId !== p2.participantId) fail('authed participant duplicated across joins');
  await firstSocketReplaced;
  log('authenticated participant de-duplicated across rejoin');

  // 5. The replaced connection must no longer be authorized to answer.
  const shown = once(pc2, 'question:show');
  const started = await ack(orgSock, 'quiz:start', {});
  if (started.error) fail('start for stale-socket check: ' + started.error);
  const question = await shown;
  const stale = await ack(pc1, 'question:answer', { optionIds: [question.options[0].id] });
  if (!stale.error) fail('replaced socket should not be allowed to answer');
  log('replaced socket loses answer permissions');

  console.log('\n✓ SECURITY CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => fail(e.message));
