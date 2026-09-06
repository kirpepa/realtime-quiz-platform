import { io } from 'socket.io-client';
import { API_URL } from './api/client.js';

// One shared socket connection for the whole app. Created lazily so pages that
// don't need realtime never open a connection.
let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(API_URL || undefined, {
      autoConnect: true,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
      randomizationFactor: 0.4,
    });
  }
  return socket;
}

// Promisified emit for request/response style events with an ack callback.
export function emitAck(event, payload) {
  return new Promise((resolve) => {
    const activeSocket = getSocket();
    if (!activeSocket.connected) {
      activeSocket.connect();
      resolve({ error: 'Нет соединения с сервером. Переподключаемся…' });
      return;
    }
    activeSocket.timeout(8_000).emit(event, payload, (error, response) => {
      if (error) {
        resolve({ error: 'Сервер не ответил вовремя. Проверьте соединение.' });
        return;
      }
      resolve(response || {});
    });
  });
}
