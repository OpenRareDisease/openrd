import type { NextFunction, Request, RequestHandler, Response } from 'express';

export const asyncHandler = <
  Req extends Request = Request,
  Res extends Response = Response,
  Next extends NextFunction = NextFunction,
>(
  handler: (req: Req, res: Res, next: Next) => unknown,
): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(handler(req as Req, res as Res, next as Next)).catch(next);
  };
};
