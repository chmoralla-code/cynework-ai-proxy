require('dotenv').config();
const app = require('./app');
const logger = require('./utils/logger');

// Catch unhandled exceptions
process.on('uncaughtException', err => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...', err);
  process.exit(1);
});

const port = process.env.PORT || 3000;

const server = app.listen(port, () => {
  logger.info(`App running on port ${port}...`);
});

// Catch unhandled promise rejections
process.on('unhandledRejection', err => {
  logger.error('UNHANDLED REJECTION! Shutting down...', err);
  server.close(() => {
    process.exit(1);
  });
});
