import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from './db';
import type { Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';

export const register = async (email: string, password: string) => {
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        const stmt = db.prepare('INSERT INTO users (email, password) VALUES (?, ?)');
        const res = stmt.run(email, hashedPassword);
        return res.lastInsertRowid;
    } catch (error: any) {
        if (error.code === 'SQLITE_CONSTRAINT') {
            throw new Error('Email sudah terdaftar');
        }
        throw error;
    }
};

export const login = async (email: string, password: string) => {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    if (!user) throw new Error('User tidak ditemukan');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new Error('Password salah');

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    return { token, user: { id: user.id, email: user.email } };
};

export const authMiddleware = (req: any, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};
