import { describe, expect, it, vi } from 'vitest';
import type { ServerResponse } from 'node:http';
import { createSseRegistry } from './sseRegistry.js';

function fakeResponse(): ServerResponse {
  return { end: vi.fn(), destroy: vi.fn() } as unknown as ServerResponse;
}

describe('createSseRegistry', () => {
  it('tracks added clients and reports their count', () => {
    const registry = createSseRegistry();
    expect(registry.size()).toBe(0);

    registry.add(fakeResponse());
    registry.add(fakeResponse());

    expect(registry.size()).toBe(2);
  });

  it('removes a client via the returned disposer', () => {
    const registry = createSseRegistry();
    const remove = registry.add(fakeResponse());
    registry.add(fakeResponse());

    remove();

    expect(registry.size()).toBe(1);
  });

  it('ends and destroys every tracked client on closeAll(), then clears the registry', () => {
    const registry = createSseRegistry();
    const a = fakeResponse();
    const b = fakeResponse();
    registry.add(a);
    registry.add(b);

    registry.closeAll();

    expect(a.end).toHaveBeenCalledTimes(1);
    expect(a.destroy).toHaveBeenCalledTimes(1);
    expect(b.end).toHaveBeenCalledTimes(1);
    expect(b.destroy).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(0);
  });

  it('is a no-op when closeAll() is called with no clients', () => {
    const registry = createSseRegistry();
    expect(() => registry.closeAll()).not.toThrow();
    expect(registry.size()).toBe(0);
  });
});
