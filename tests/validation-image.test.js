const { validateImage } = require('../src/utils/validation');

describe('validateImage', () => {
  test('accepts data URLs and normalizes mime type', () => {
    const image = validateImage({
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      mimeType: 'image'
    });

    expect(image.mimeType).toBe('image/png');
    expect(image.data.startsWith('iVBORw0KGgo')).toBe(true);
  });

  test('infers png mime type when client sends generic image mime type', () => {
    const image = validateImage({
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      mimeType: 'image'
    });

    expect(image.mimeType).toBe('image/png');
  });
});
