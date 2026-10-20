/**
 * DS-1 · compile-time proof that the contracts (src/studio/contracts) and the
 * renderer's structural types (render/types.ts) agree: a ReportDoc v2 is a
 * RenderDoc, every contract element type has a renderer, and the page sizes
 * match. `npm run build` fails when a contract change isn't followed here.
 * Nothing in this file runs.
 */
import type { ElementType as ContractElementType, PageFormat as ContractPageFormat, ReportDoc } from "../../studio/contracts";
import type { ElementType, PageFormat, RenderDoc } from "./render/types";

type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type DocIsRenderable = Assert<ReportDoc extends RenderDoc ? true : false>;
export type ElementTypesAgree = Assert<Same<ContractElementType, ElementType>>;
export type FormatsAgree = Assert<Same<ContractPageFormat, PageFormat>>;
