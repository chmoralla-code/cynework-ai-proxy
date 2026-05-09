const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

class HistoryManager {
  constructor() {
    this.inMemoryFallback = new Map();
    this.useSupabase = false;
    this.supabase = null;
    this.MAX_HISTORY_LENGTH = parseInt(process.env.MAX_HISTORY_LENGTH, 10) || 20; // 20 messages per session max
  }

  async init() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Required to bypass RLS for a backend history service

    if (supabaseUrl && supabaseKey) {
      try {
        this.supabase = createClient(supabaseUrl, supabaseKey);
        
        // Basic ping to test connection and permissions
        const { error } = await this.supabase.from('chat_history').select('id').limit(1);
        if (error) throw error;

        this.useSupabase = true;
        logger.info('Connected to Supabase Postgres for session history');
      } catch (error) {
        logger.error('Failed to connect to Supabase, using in-memory fallback', error);
        this.useSupabase = false;
      }
    } else {
      logger.info('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set, using in-memory fallback for session history');
    }
  }

  async getHistory(sessionId) {
    if (this.useSupabase) {
      try {
        // Fetch latest N messages for the session, ordered by creation time
        const { data, error } = await this.supabase
          .from('chat_history')
          .select('role, text, image')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false }) // Get newest first to apply limit
          .limit(this.MAX_HISTORY_LENGTH);

        if (error) throw error;

        if (data && data.length > 0) {
          // Reverse back to chronological order for the model
          return data.reverse().map(row => {
            const parts = [{ text: row.text }];
            if (row.image) {
              parts.push({ inlineData: { data: row.image.data, mimeType: row.image.mimeType } });
            }
            return { role: row.role, parts };
          });
        }
        return [];
      } catch (err) {
        logger.error(`Error reading from Supabase for session ${sessionId}, falling back to memory`, err);
        return this.inMemoryFallback.get(sessionId) || [];
      }
    } else {
      return this.inMemoryFallback.get(sessionId) || [];
    }
  }

  async addMessage(sessionId, role, text, image = null, userId = null, thinkingLevel = null) {
    if (this.useSupabase) {
      try {
        const { error } = await this.supabase
          .from('chat_history')
          .insert([{ session_id: sessionId, user_id: userId, role, text, image, thinking_level: thinkingLevel }]);

        if (error) throw error;
        
        // The DB accumulates history. We rely on the limit clause in getHistory to truncate the prompt context.
        // In a production app, a cron job (pg_cron) could delete old rows to save space.
      } catch (err) {
        logger.error(`Error writing to Supabase for session ${sessionId}, falling back to memory`, err);
        this._addMessageToMemory(sessionId, role, text, image);
      }
    } else {
      this._addMessageToMemory(sessionId, role, text, image);
    }
  }

  _addMessageToMemory(sessionId, role, text, image = null) {
    const history = this.inMemoryFallback.get(sessionId) || [];
    const parts = [{ text }];
    if (image) {
      parts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
    }
    history.push({ role, parts });
    
    if (history.length > this.MAX_HISTORY_LENGTH) {
      this.inMemoryFallback.set(sessionId, history.slice(history.length - this.MAX_HISTORY_LENGTH));
    } else {
      this.inMemoryFallback.set(sessionId, history);
    }
  }
}

const historyManager = new HistoryManager();
// Fire and forget init, if it fails it falls back synchronously
historyManager.init().catch(err => logger.error('History Manager init failed', err));

module.exports = historyManager;
