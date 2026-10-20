/**
 * PRO-0 · the placeholder answer for a contract route whose module hasn't
 * landed yet: 501 DS_NOT_BUILT {module}. It runs behind requireDesignStudio
 * (and requireManager where the route needs it), so switch-off and role
 * answers are already final. The module replaces its router file.
 */
import { DsError } from "./contracts/errors";
import { handle } from "./http";

export const notBuilt = (module: string) =>
  handle(`${module} (not built)`, async () => {
    throw new DsError("DS_NOT_BUILT", { module });
  });
