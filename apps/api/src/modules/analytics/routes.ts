import type { Request, Response } from 'express';
import { employerAnalytics, workerAnalytics } from './service';

export const workerAnalyticsRoute = async (req: Request, res: Response) => {
  res.json(await workerAnalytics(req.user!.id));
};
export const employerAnalyticsRoute = async (req: Request, res: Response) => {
  res.json(await employerAnalytics(req.user!.id));
};
