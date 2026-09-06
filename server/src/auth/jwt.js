import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signAccessToken(payload) {
  return jwt.sign({ ...payload, tokenType: 'access' }, config.jwt.accessSecret, {
    algorithm: 'HS256',
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    expiresIn: config.jwt.accessTtl,
  });
}

export function signRefreshToken(payload) {
  return jwt.sign({ ...payload, tokenType: 'refresh' }, config.jwt.refreshSecret, {
    algorithm: 'HS256',
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    expiresIn: config.jwt.refreshTtl,
  });
}

export function verifyAccessToken(token) {
  const decoded = jwt.verify(token, config.jwt.accessSecret, {
    algorithms: ['HS256'],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
  if (decoded.tokenType !== 'access') throw new Error('Неверный тип токена');
  return decoded;
}

export function verifyRefreshToken(token) {
  const decoded = jwt.verify(token, config.jwt.refreshSecret, {
    algorithms: ['HS256'],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
  if (decoded.tokenType !== 'refresh') throw new Error('Неверный тип токена');
  return decoded;
}
