const request = require('supertest');
const app = require('../src/app');
const { generateChatStream } = require('../src/services/gemini');

const defaultStream = async function* () {
  yield { text: 'Hello from mock stream chunk 1' };
  yield { text: ' chunk 2' };
};

// Mock the Gemini service to avoid hitting the real API during tests
jest.mock('../src/services/gemini', () => ({
  generateChatStream: jest.fn(defaultStream)
}));

describe('Chat API', () => {
  beforeEach(() => {
    generateChatStream.mockImplementation(defaultStream);
  });

  test('POST /chat without sessionId or message should fail validation', async () => {
    const res = await request(app)
      .post('/chat')
      .send({});
    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/Invalid session ID/);
  });

  test('POST /chat should return concatenated text response', async () => {
    const res = await request(app)
      .post('/chat')
      .send({
        sessionId: 'test_session_123',
        message: 'Hello'
      });
    expect(res.statusCode).toEqual(200);
    expect(res.body.text).toBe('Hello from mock stream chunk 1 chunk 2');
  });

  test('POST /chat/stream should return text/event-stream', async () => {
    const res = await request(app)
      .post('/chat/stream')
      .send({
        sessionId: 'test_session_123',
        message: 'Stream test'
      });
    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('data: {"text":"Hello from mock stream chunk 1"}');
    expect(res.text).toContain('data: [DONE]');
  });

  test('POST /chat/stream with image should return 200', async () => {
    const res = await request(app)
      .post('/chat/stream')
      .send({
        sessionId: 'test_session_123',
        message: 'What is in this image?',
        image: {
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', // 1x1 black png
          mimeType: 'image/png'
        }
      });
    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  test('POST /chat should map provider 429 to friendly quota error', async () => {
    generateChatStream.mockImplementationOnce(async function* () {
      const error = new Error('{"error":{"code":429,"message":"Quota exceeded for metric","status":"RESOURCE_EXHAUSTED"}}');
      error.status = 429;
      throw error;
    });

    const res = await request(app)
      .post('/chat')
      .send({
        sessionId: 'test_session_123',
        message: 'Hello'
      });

    expect(res.statusCode).toEqual(429);
    expect(res.body.error).toBe('AI provider rate limit exceeded. Please retry shortly.');
  });
});
