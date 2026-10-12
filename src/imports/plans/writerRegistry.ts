import { EmissionWriter } from "../writer";
import { emissionWriter } from "../../services/emissionWrite";

/**
 * Which EmissionWriter the plans API uses: IM1's emission write service, the
 * one engine typed entries, bulk uploads and Claude imports share. Tests may
 * swap it with `setEmissionWriter`; nothing else does.
 */
let writer: EmissionWriter = emissionWriter;

export const setEmissionWriter = (w: EmissionWriter) => {
  writer = w;
};

export const getEmissionWriter = (): EmissionWriter => writer;
