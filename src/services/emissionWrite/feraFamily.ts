/**
 * S3-7 · every other row of an emission's FERA family: the parent, its
 * upstream twin (3a/3b) and its T&D-loss twin (3c). The parent and the
 * upstream twin link both ways; the 3c twin links to the parent only. So
 * from any member, the family is its forward link plus every row linking to
 * it or to that forward link. Single delete, approve and reject act on the
 * whole family, whichever member they were called on.
 */
import { In, type Repository } from "typeorm";
import type { Emission } from "../../entities/Emission";

export const feraFamilyIds = async (repo: Repository<Emission>, e: Pick<Emission, "pk_id" | "fera_linked_id">): Promise<number[]> => {
  const ids = new Set<number>();
  if (e.fera_linked_id) ids.add(e.fera_linked_id);
  const anchors = e.fera_linked_id ? [e.pk_id, e.fera_linked_id] : [e.pk_id];
  const back = await repo.find({ where: { fera_linked_id: In(anchors) }, select: ["pk_id"] });
  for (const b of back) ids.add(b.pk_id);
  ids.delete(e.pk_id);
  return [...ids];
};
