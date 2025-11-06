import type { Request, Response } from 'express';
import { loginSchema, registerSchema } from './auth.schema';
import type { AuthService } from './auth.service';

export class AuthController {
  constructor(private readonly service: AuthService) {}

  register = async (req: Request, res: Response) => {
    const payload = registerSchema.parse(req.body);
    const result = await this.service.register(payload);
    res.status(201).json(result);
  };

  login = async (req: Request, res: Response) => {
    const payload = loginSchema.parse(req.body);
    const result = await this.service.login(payload);
    res.status(200).json(result);
  };
}
