// Mock twitter-api-v2 for testing

export class TwitterApi {
  private _readWrite: TwitterApiReadWrite;

  constructor(_credentials: unknown) {
    this._readWrite = new TwitterApiReadWrite();
  }

  get readWrite(): TwitterApiReadWrite {
    return this._readWrite;
  }
}

export class TwitterApiReadWrite {
  v2 = {
    async tweet(_content: string | { text: string; media?: unknown }) {
      return {
        data: {
          id: 'mock-tweet-id-' + Date.now(),
          text: typeof _content === 'string' ? _content : _content.text,
        },
      };
    },
  };

  v1 = {
    async uploadMedia(_buffer: Buffer, _options?: unknown) {
      return 'mock-media-id-' + Date.now();
    },
  };
}

export type { TwitterApiReadWrite };
