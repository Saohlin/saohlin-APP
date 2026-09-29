/**
 * Incremental Server-Sent Events parser for the chat stream. Chunks can split
 * anywhere (mid-line, mid-UTF-8 is handled by the TextDecoder before this), so
 * input is buffered until a blank line ends an event.
 */
export type RawEvent = { event: string; data: unknown };

export function createSseParser(onEvent: (e: RawEvent) => void) {
  let buf = '';
  const flush = (block: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join('\n'));
    } catch {
      return; // a malformed event is dropped, never shown
    }
    onEvent({ event, data: parsed });
  };
  return {
    push(chunk: string) {
      buf += chunk.replace(/\r\n/g, '\n');
      let at: number;
      while ((at = buf.indexOf('\n\n')) !== -1) {
        flush(buf.slice(0, at));
        buf = buf.slice(at + 2);
      }
    },
    end() {
      if (buf.trim()) flush(buf);
      buf = '';
    },
  };
}
