// Simple structured logger
const logger = {
  info: (message, meta = {}) => {
    console.log(JSON.stringify({ level: 'info', timestamp: new Date().toISOString(), message, ...meta }));
  },
  error: (message, error = {}, meta = {}) => {
    const errorDetails = error instanceof Error ? { message: error.message, stack: error.stack } : error;
    console.error(JSON.stringify({ level: 'error', timestamp: new Date().toISOString(), message, error: errorDetails, ...meta }));
  },
  warn: (message, meta = {}) => {
    console.warn(JSON.stringify({ level: 'warn', timestamp: new Date().toISOString(), message, ...meta }));
  }
};

module.exports = logger;
