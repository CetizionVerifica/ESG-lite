/**
 * The one error the plans API raises that is not in contracts §5: it exists
 * only until IM2 part 2 wires the real EmissionWriter (IM1), and is removed
 * then. Everything else is an IM0 `ImportError`.
 */
export class EngineNotReadyError extends Error {
  readonly code = "IMPORT_ENGINE_NOT_READY" as const;
  readonly status = 503;
  constructor() {
    super("The import engine is not wired on this server yet.");
    this.name = "EngineNotReadyError";
  }
}
