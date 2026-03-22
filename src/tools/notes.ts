import { NotesStore } from '../notes-store.js';
import { logger } from '../logger.js';

export function logSessionNote(
  notesStore: NotesStore,
  date: string,
  note: string,
  tags: string[]
): string {
  logger.debug('Tool: log_session_note', { date, tags });
  return notesStore.log(date, note, tags);
}

export function getSessionNotes(
  notesStore: NotesStore,
  start_date: string,
  end_date: string
): string {
  logger.debug('Tool: get_session_notes', { start_date, end_date });

  const notes = notesStore.get(start_date, end_date);

  if (notes.length === 0) {
    return `No session notes found between ${start_date} and ${end_date}.`;
  }

  const header = `Session notes: ${start_date} → ${end_date}\n`;
  const entries = notes.map((n) => {
    const tagsStr = n.tags.length > 0 ? `  [${n.tags.join(', ')}]` : '';
    return `${n.date}${tagsStr}\n  "${n.note}"`;
  });

  return header + entries.join('\n\n');
}

export function deleteSessionNote(notesStore: NotesStore, date: string): string {
  logger.debug('Tool: delete_session_note', { date });
  return notesStore.delete(date);
}
