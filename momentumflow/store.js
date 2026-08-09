import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Configurable so a deployment platform's persistent volume can be mounted
// somewhere else (e.g. Railway) without code changes — just set DATA_DIR.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readJson(name, fallback) {
  const p = filePath(name);
  if (!fs.existsSync(p)) return fallback;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error(`[store] Failed to parse ${name}.json, using fallback:`, err.message);
    return fallback;
  }
}

function writeJson(name, data) {
  const p = filePath(name);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p); // atomic-ish write to avoid corrupting the file on crash
}

export const store = {
  // Generic collection helpers, keyed by store name ("sessions", "trades", etc.)
  getAll(name) {
    return readJson(name, []);
  },
  saveAll(name, items) {
    writeJson(name, items);
  },
  getOne(name, id) {
    return this.getAll(name).find((item) => item.id === id) || null;
  },
  insert(name, item) {
    const items = this.getAll(name);
    items.push(item);
    this.saveAll(name, items);
    return item;
  },
  update(name, id, patch) {
    const items = this.getAll(name);
    const idx = items.findIndex((item) => item.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch };
    this.saveAll(name, items);
    return items[idx];
  },
  // Singleton config-like objects (e.g. settings, live gate state)
  getConfig(name, fallback) {
    return readJson(name, fallback);
  },
  setConfig(name, data) {
    writeJson(name, data);
    return data;
  },
};
