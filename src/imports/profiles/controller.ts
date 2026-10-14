import { Response } from "express";
import { AuthRequest } from "../../middlewares/auth.middleware";
import { isImportError } from "../errors";
import * as profiles from "./service";

/** HTTP layer of the mapping-profile endpoints (XI3): parse, call, map ImportError. */

const fail = (res: Response, err: unknown) => {
  if (isImportError(err)) return res.status(err.status).json(err.toBody());
  console.error("Mapping profiles error:", err);
  return res.status(500).json({ code: "INTERNAL", message: "Internal server error" });
};

const user = (req: AuthRequest) => ({ userId: Number(req.user?.userId), role: String(req.user?.role) });

export const listProfiles = async (req: AuthRequest, res: Response) => {
  try {
    return res.json(await profiles.listProfiles(user(req), req.query as Record<string, unknown>));
  } catch (err) {
    return fail(res, err);
  }
};

export const deleteProfile = async (req: AuthRequest, res: Response) => {
  try {
    return res.json(await profiles.deleteProfile(user(req), String(req.params.id)));
  } catch (err) {
    return fail(res, err);
  }
};
