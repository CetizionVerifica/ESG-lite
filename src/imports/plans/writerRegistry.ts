import { EmissionWriter } from "../writer";
import { EngineNotReadyError } from "./apiError";
import { fakeWriter } from "./fakeWriter";

/**
 * Which EmissionWriter the plans API uses. IM2 part 2 registers IM1's
 * writer at startup (`setEmissionWriter`). Until then only the fake writer
 * exists, and only tests and local development may use it
 * (IMPORT_FAKE_WRITER=true, or the throwaway CI database): anywhere else the
 * plans endpoints answer 503 IMPORT_ENGINE_NOT_READY rather than plan or
 * save anything with made-up numbers.
 */
let writer: EmissionWriter | null = null;

export const setEmissionWriter = (w: EmissionWriter) => {
  writer = w;
};

const fakeAllowed = () => process.env.IMPORT_FAKE_WRITER === "true" || process.env.CI_THROWAWAY_DB === "true";

export const getEmissionWriter = (): EmissionWriter => {
  if (writer) return writer;
  if (fakeAllowed()) return fakeWriter;
  throw new EngineNotReadyError();
};
