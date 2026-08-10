import type { ServerResponse } from 'node:http';

/**
 * `/api/events`는 `reply.hijack()`으로 Fastify의 요청 생명주기를 벗어나
 * keep-alive 소켓을 직접 붙잡고 있는다. Fastify의 `app.close()`(Node
 * `http.Server.close()`)는 열려 있는 모든 연결이 스스로 끝날 때까지
 * 기다리므로, 클라이언트가 붙어 있는 SSE 연결이 하나라도 있으면 서버가
 * 절대 종료되지 않는다. shutdown 시 HTTP drain(app.close()) 전에 이
 * 레지스트리로 추적 중인 모든 SSE 연결을 명시적으로 끊어야 한다.
 */
export interface SseRegistry {
  /** 새 SSE 연결을 추적 목록에 등록한다. 연결이 스스로 끝나면 반환된 함수로 해제한다. */
  add(res: ServerResponse): () => void;
  /** 추적 중인 모든 SSE 연결을 즉시 종료한다. */
  closeAll(): void;
  /** 현재 추적 중인 연결 수. */
  size(): number;
}

export function createSseRegistry(): SseRegistry {
  const clients = new Set<ServerResponse>();

  return {
    add(res) {
      clients.add(res);
      return () => clients.delete(res);
    },
    closeAll() {
      for (const res of clients) {
        res.end();
        res.destroy();
      }
      clients.clear();
    },
    size() {
      return clients.size;
    },
  };
}
