import type { FastifyReply } from 'fastify';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function sendApiError(reply: FastifyReply, error: ApiError): void {
  reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
}
