import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

interface NotesFile {
  version: 1;
  notes: Record<string, SessionNote>;
}

export interface SessionNote {
  date: string; // "YYYY-MM-DD" — also the key
  note: string; // free text athlete debrief
  tags: string[]; // optional tags, default []
  createdAt: string; // ISO datetime, set at write time, never updated
}

const NOTES_DIR = path.join(os.homedir(), '.oura-mcp');
const NOTES_FILE = path.join(NOTES_DIR, 'notes.json');

const EMPTY_FILE: NotesFile = { version: 1, notes: {} };

export class NotesStore {
  constructor() {
    this.init();
  }

  private init(): void {
    try {
      if (!fs.existsSync(NOTES_DIR)) {
        fs.mkdirSync(NOTES_DIR, { recursive: true });
        logger.debug(`Created notes directory: ${NOTES_DIR}`);
      }
      if (!fs.existsSync(NOTES_FILE)) {
        fs.writeFileSync(NOTES_FILE, JSON.stringify(EMPTY_FILE, null, 2), 'utf-8');
        logger.debug(`Created notes file: ${NOTES_FILE}`);
      }
    } catch (err) {
      // Log but don't crash — tools will return error strings if operations fail
      logger.error('Failed to initialise notes store', err);
    }
  }

  private read(): NotesFile {
    const raw = fs.readFileSync(NOTES_FILE, 'utf-8');
    return JSON.parse(raw) as NotesFile;
  }

  private write(data: NotesFile): void {
    fs.writeFileSync(NOTES_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  log(date: string, note: string, tags: string[]): string {
    try {
      const data = this.read();

      if (data.notes[date]) {
        return `A note already exists for ${date}. Use delete_session_note to remove it first, then re-log.`;
      }

      const entry: SessionNote = {
        date,
        note,
        tags,
        createdAt: new Date().toISOString(),
      };

      data.notes[date] = entry;
      this.write(data);

      logger.debug(`Note saved for ${date}`);

      const tagsStr = tags.length > 0 ? `\n  Tags: ${tags.join(', ')}` : '';
      return `✓ Note saved for ${date}\n  "${note}"${tagsStr}`;
    } catch (err) {
      logger.error('Failed to log note', err);
      return `Failed to save note: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  get(startDate: string, endDate: string): SessionNote[] {
    try {
      const data = this.read();
      return Object.values(data.notes)
        .filter((n) => n.date >= startDate && n.date <= endDate)
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch (err) {
      logger.error('Failed to read notes', err);
      return [];
    }
  }

  delete(date: string): string {
    try {
      const data = this.read();

      if (!data.notes[date]) {
        return `No note found for ${date}. Nothing to delete.`;
      }

      delete data.notes[date];
      this.write(data);

      logger.debug(`Note deleted for ${date}`);
      return `✓ Note deleted for ${date}.`;
    } catch (err) {
      logger.error('Failed to delete note', err);
      return `Failed to delete note: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
