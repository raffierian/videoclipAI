import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Tentukan lokasi database yang aman (AppData untuk Windows, atau folder lokal jika dev)
const dbDir = process.env.APPDATA ? path.join(process.env.APPDATA, 'ViralClipAI') : path.resolve('.');
if (!fs.existsSync(dbDir)) { fs.mkdirSync(dbDir, { recursive: true }); }

const dbPath = path.join(dbDir, 'database.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Migrations
const initDb = () => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT,
      url TEXT,
      status TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      details TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS channels (
      user_id INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (user_id, channel_id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS tokens (
      user_id INTEGER PRIMARY KEY,
      tokens TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS processed_videos (
      user_id INTEGER NOT NULL,
      video_id TEXT NOT NULL,
      PRIMARY KEY (user_id, video_id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER PRIMARY KEY,
      gemini_key TEXT,
      openai_key TEXT,
      groq_key TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS app_license (
      id INTEGER PRIMARY KEY,
      license_key TEXT,
      activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Safe migrations for new columns
  try { db.exec("ALTER TABLE settings ADD COLUMN youtube_client_id TEXT;"); } catch (e) { }
  try { db.exec("ALTER TABLE settings ADD COLUMN youtube_client_secret TEXT;"); } catch (e) { }
};

initDb();

export default db;
