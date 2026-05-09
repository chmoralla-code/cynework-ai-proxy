const historyManager = require('../src/services/history');

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ error: new Error('Supabase connection failed'), data: null }), // Force fallback
  }))
}));

describe('History Manager', () => {
  beforeAll(async () => {
    // Ensure we trigger the fallback initialization
    process.env.SUPABASE_URL = 'https://invalid-url.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'invalid-key';
    await historyManager.init();
  });

  test('falls back to in-memory store when Supabase fails', async () => {
    expect(historyManager.useSupabase).toBe(false);
  });

  test('adds and retrieves messages from in-memory fallback', async () => {
    const sessionId = 'test-session-1';
    
    await historyManager.addMessage(sessionId, 'user', 'Hello');
    await historyManager.addMessage(sessionId, 'model', 'Hi there');

    const history = await historyManager.getHistory(sessionId);
    
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[0].parts[0].text).toBe('Hello');
    expect(history[1].role).toBe('model');
    expect(history[1].parts[0].text).toBe('Hi there');
  });

  test('limits history length based on MAX_HISTORY_LENGTH', async () => {
     historyManager.MAX_HISTORY_LENGTH = 3;
     const sessionId = 'test-session-limit';
     
     await historyManager.addMessage(sessionId, 'user', 'Msg 1');
     await historyManager.addMessage(sessionId, 'model', 'Msg 2');
     await historyManager.addMessage(sessionId, 'user', 'Msg 3');
     await historyManager.addMessage(sessionId, 'model', 'Msg 4');

     const history = await historyManager.getHistory(sessionId);
     expect(history).toHaveLength(3);
     expect(history[0].parts[0].text).toBe('Msg 2');
     expect(history[2].parts[0].text).toBe('Msg 4');
  });
});
