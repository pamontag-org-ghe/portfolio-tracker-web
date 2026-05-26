import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, signToken, verifyPassword } from '../auth/jwt.js';
import { getRepository } from '../data/index.js';
import { HttpError } from '../middleware/error.js';
import { newId } from '../utils/ids.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1).max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post('/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const repo = getRepository();
    const existing = await repo.users.findByEmail(body.email);
    if (existing) throw new HttpError(409, 'Email already registered');
    const user = await repo.users.create({
      id: newId(),
      email: body.email.toLowerCase(),
      passwordHash: await hashPassword(body.password),
      displayName: body.displayName,
      createdAt: new Date().toISOString(),
    });
    const token = signToken(user);
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    });
  } catch (err) { next(err); }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const repo = getRepository();
    const user = await repo.users.findByEmail(body.email);
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new HttpError(401, 'Invalid email or password');
    }
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    });
  } catch (err) { next(err); }
});

authRouter.get('/me', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const repo = getRepository();
    const user = await repo.users.findById(req.userId!);
    if (!user) throw new HttpError(404, 'User not found');
    res.json({
      id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt,
    });
  } catch (err) { next(err); }
});
