import { jest } from '@jest/globals';
import { logSessionNote, getSessionNotes, deleteSessionNote } from '../../tools/notes.js';
import type { NotesStore, SessionNote } from '../../notes-store.js';

function makeStore(overrides: Partial<NotesStore> = {}): NotesStore {
  return {
    log: jest.fn().mockReturnValue('✓ Note saved'),
    get: jest.fn().mockReturnValue([]),
    delete: jest.fn().mockReturnValue('✓ Note deleted'),
    ...overrides,
  } as unknown as NotesStore;
}

function makeNote(overrides: Partial<SessionNote> = {}): SessionNote {
  return { date: '2025-03-10', note: 'Solid session', tags: ['easy'], createdAt: '2025-03-10T10:00:00Z', ...overrides };
}

describe('logSessionNote', () => {
  it('delegates to notesStore.log and returns its result', () => {
    const store = makeStore();
    const result = logSessionNote(store, '2025-03-10', 'Easy run', ['felt-easy']);
    expect(store.log).toHaveBeenCalledWith('2025-03-10', 'Easy run', ['felt-easy']);
    expect(result).toBe('✓ Note saved');
  });
});

describe('getSessionNotes', () => {
  it('returns formatted notes when notes exist in range', () => {
    const notes = [
      makeNote({ date: '2025-03-10', note: 'Easy run', tags: ['felt-easy'] }),
      makeNote({ date: '2025-03-12', note: 'Long run', tags: [] }),
    ];
    const store = makeStore({ get: jest.fn().mockReturnValue(notes) } as Partial<NotesStore>);
    const result = getSessionNotes(store, '2025-03-10', '2025-03-12');
    expect(result).toContain('Session notes: 2025-03-10 → 2025-03-12');
    expect(result).toContain('Easy run');
    expect(result).toContain('felt-easy');
    expect(result).toContain('Long run');
    // Note without tags should not show brackets
    expect(result).not.toMatch(/2025-03-12\s+\[/);
  });

  it('returns empty message when no notes in range', () => {
    const store = makeStore({ get: jest.fn().mockReturnValue([]) } as Partial<NotesStore>);
    const result = getSessionNotes(store, '2025-03-01', '2025-03-07');
    expect(result).toContain('No session notes found between 2025-03-01 and 2025-03-07');
  });

  it('formats tags in brackets', () => {
    const notes = [makeNote({ tags: ['hard', 'long-run'] })];
    const store = makeStore({ get: jest.fn().mockReturnValue(notes) } as Partial<NotesStore>);
    const result = getSessionNotes(store, '2025-03-10', '2025-03-10');
    expect(result).toContain('[hard, long-run]');
  });
});

describe('deleteSessionNote', () => {
  it('delegates to notesStore.delete and returns its result', () => {
    const store = makeStore();
    const result = deleteSessionNote(store, '2025-03-10');
    expect(store.delete).toHaveBeenCalledWith('2025-03-10');
    expect(result).toBe('✓ Note deleted');
  });
});
