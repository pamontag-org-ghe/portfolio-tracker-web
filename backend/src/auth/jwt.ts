import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { User } from '../types.js';

export interface JwtPayload {
  sub: string;
  email: string;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(user: Pick<User, 'id' | 'email'>): string {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, { expiresIn: '7d' });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, config.jwtSecret);
  if (typeof decoded === 'string' || !decoded.sub) {
    throw new Error('Invalid token');
  }
  return decoded as JwtPayload;
}
