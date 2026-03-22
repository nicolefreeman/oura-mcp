import { jest } from '@jest/globals';
import fs from 'fs';
import { NotesStore } from '../notes-store.js';

const EMPTY_NOTES = JSON.stringify({ version: 1, notes: {} });

function notesWithEntry(date: string) {
  return JSON.stringify({
    version: 1,
    notes: {
      [date]: { date, note: 'Good run', tags: ['hard'], createdAt: '2025-03-01T10:00:00.000Z' },
    },
  });
}

beforeEach(() => {
  jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as unknown as ReturnType<typeof fs.mkdirSync>);
  jest.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);
  jest.spyOn(fs, 'readFileSync').mockReturnValue(EMPTY_NOTES as unknown as Buffer);
  jest.spyOn(fs, 'appendFileSync').mockReturnValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('NotesStore init', () => {
  it('does not create dir or file when both already exist', () => {
    (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValue(true);
    new NotesStore();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('creates directory when it does not exist', () => {
    (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    new NotesStore();
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it('creates notes file when it does not exist', () => {
    (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    new NotesStore();
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('handles init errors gracefully without throwing', () => {
    (fs.existsSync as jest.MockedFunction<typeof fs.existsSync>).mockReturnValueOnce(false);
    (fs.mkdirSync as jest.MockedFunction<typeof fs.mkdirSync>).mockImplementationOnce(() => {
      throw new Error('Permission denied');
    });
    expect(() => new NotesStore()).not.toThrow();
  });
});

describe('NotesStore.log', () => {
  it('saves a new note and returns success message', () => {
    const store = new NotesStore();
    const result = store.log('2025-03-10', 'Felt great today', ['easy', 'long-run']);
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(result).toContain('✓ Note saved for 2025-03-10');
    expect(result).toContain('Felt great today');
    expect(result).toContain('easy, long-run');
  });

  it('returns success message without tags section when tags is empty', () => {
    const store = new NotesStore();
    const result = store.log('2025-03-10', 'Rest day', []);
    expect(result).toContain('✓ Note saved for 2025-03-10');
    expect(result).not.toContain('Tags:');
  });

  it('refuses to overwrite an existing note for the same date', () => {
    (fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>)
      .mockReturnValue(notesWithEntry('2025-03-10') as unknown as Buffer);
    const store = new NotesStore();
    const result = store.log('2025-03-10', 'Duplicate note', []);
    expect(result).toContain('A note already exists for 2025-03-10');
    // writeFileSync was called once during init (creating the notes file check doesn't apply here
    // since existsSync returns true), so it should NOT be called again for the duplicate
    const writeCallsBeforeLog = (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mock.calls.length;
    const result2 = store.log('2025-03-10', 'Another duplicate', []);
    expect(result2).toContain('A note already exists for 2025-03-10');
    expect((fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mock.calls.length).toBe(writeCallsBeforeLog);
  });

  it('returns error string on fs read failure during log (Error instance)', () => {
    const store = new NotesStore();
    (fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>).mockImplementationOnce(() => {
      throw new Error('Disk full');
    });
    const result = store.log('2025-03-10', 'note', []);
    expect(result).toContain('Failed to save note');
    expect(result).toContain('Disk full');
  });

  it('returns error string on fs read failure during log (non-Error thrown)', () => {
    const store = new NotesStore();
    (fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>).mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'string error';
    });
    const result = store.log('2025-03-10', 'note', []);
    expect(result).toContain('Failed to save note');
    expect(result).toContain('string error');
  });
});

describe('NotesStore.get', () => {
  it('returns notes within the date range, sorted chronologically', () => {
    (fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>).mockReturnValue(
      JSON.stringify({
        version: 1,
        notes: {
          '2025-03-05': { date: '2025-03-05', note: 'Day 5', tags: [], createdAt: '' },
          '2025-03-01': { date: '2025-03-01', note: 'Day 1', tags: [], createdAt: '' },
          '2025-03-10': { date: '2025-03-10', note: 'Day 10', tags: [], createdAt: '' },
        },
      }) as unknown as Buffer
    );
    const store = new NotesStore();
    const result = store.get('2025-03-01', '2025-03-07');
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2025-03-01');
    expect(result[1].date).toBe('2025-03-05');
  });

  it('returns empty array when no notes in range', () => {
    const store = new NotesStore();
    const result = store.get('2025-03-01', '2025-03-07');
    expect(result).toEqual([]);
  });

  it('returns empty array and does not throw on fs read error', () => {
    const store = new NotesStore();
    (fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>).mockImplementationOnce(() => {
      throw new Error('File missing');
    });
    const result = store.get('2025-03-01', '2025-03-07');
    expect(result).toEqual([]);
  });
});

describe('NotesStore.delete', () => {
  it('deletes an existing note and returns success message', () => {
    (fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>)
      .mockReturnValue(notesWithEntry('2025-03-10') as unknown as Buffer);
    const store = new NotesStore();
    const callsBefore = (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mock.calls.length;
    const result = store.delete('2025-03-10');
    expect(fs.writeFileSync).toHaveBeenCalledTimes(callsBefore + 1);
    expect(result).toContain('✓ Note deleted for 2025-03-10');
  });

  it('returns not-found message when note does not exist', () => {
    const store = new NotesStore();
    const callsBefore = (fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mock.calls.length;
    const result = store.delete('2025-03-10');
    expect(result).toContain('No note found for 2025-03-10');
    expect(fs.writeFileSync).toHaveBeenCalledTimes(callsBefore);
  });

  it('returns error string on fs read failure during delete (Error instance)', () => {
    const store = new NotesStore();
    (fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>).mockImplementationOnce(() => {
      throw new Error('Read error');
    });
    const result = store.delete('2025-03-10');
    expect(result).toContain('Failed to delete note');
    expect(result).toContain('Read error');
  });

  it('returns error string on fs read failure during delete (non-Error thrown)', () => {
    const store = new NotesStore();
    (fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>).mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 42;
    });
    const result = store.delete('2025-03-10');
    expect(result).toContain('Failed to delete note');
    expect(result).toContain('42');
  });
});
