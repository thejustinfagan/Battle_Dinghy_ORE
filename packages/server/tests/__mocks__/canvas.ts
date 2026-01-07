// Mock canvas for testing
// Returns a minimal PNG buffer for card rendering tests

class MockContext2D {
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  font = '12px sans-serif';
  textAlign = 'left' as CanvasTextAlign;
  textBaseline = 'top' as CanvasTextBaseline;

  fillRect(_x: number, _y: number, _w: number, _h: number): void {}
  strokeRect(_x: number, _y: number, _w: number, _h: number): void {}
  clearRect(_x: number, _y: number, _w: number, _h: number): void {}
  fillText(_text: string, _x: number, _y: number): void {}
  strokeText(_text: string, _x: number, _y: number): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(_x: number, _y: number): void {}
  lineTo(_x: number, _y: number): void {}
  arc(_x: number, _y: number, _r: number, _start: number, _end: number): void {}
  fill(): void {}
  stroke(): void {}
  save(): void {}
  restore(): void {}
  translate(_x: number, _y: number): void {}
  rotate(_angle: number): void {}
  scale(_x: number, _y: number): void {}
  measureText(_text: string) {
    return { width: _text.length * 8 };
  }
}

export function createCanvas(width: number, height: number) {
  return {
    width,
    height,
    getContext(_type: string) {
      return new MockContext2D();
    },
    toBuffer(_type?: string) {
      // Return a minimal valid PNG (1x1 transparent pixel)
      return Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, // bit depth, color type, etc
        0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
        0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, // compressed data
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND chunk
        0xae, 0x42, 0x60, 0x82,
      ]);
    },
  };
}

export function loadImage(_src: string | Buffer) {
  return Promise.resolve({
    width: 100,
    height: 100,
  });
}

export function registerFont(_path: string, _options: unknown) {
  // No-op
}
