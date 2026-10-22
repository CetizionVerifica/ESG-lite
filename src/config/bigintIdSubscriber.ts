import { EventSubscriber, type EntitySubscriberInterface, type InsertEvent } from "typeorm";

/**
 * #191: after an insert TypeORM writes a generated bigint id back onto the entity as a string
 * (its fix for typeorm#720, `ColumnMetadata.createValueMap`), while every read returns a number
 * (`pgTypes.ts`). A second `save()` of the same entity then can't match the stored row and inserts
 * a copy. Turn the id back into a number as soon as the insert is done, so an entity's id is a
 * number whichever way it was obtained.
 */
@EventSubscriber()
export class BigintIdSubscriber implements EntitySubscriberInterface {
  afterInsert(event: InsertEvent<unknown>): void {
    const entity = event.entity as object | undefined;
    if (!entity || typeof entity !== "object") return;
    for (const column of event.metadata.primaryColumns) {
      if (column.type !== "bigint" || column.generationStrategy !== "increment") continue;
      const value = column.getEntityValue(entity);
      if (typeof value === "string" && value !== "") column.setEntityValue(entity, Number(value));
    }
  }
}
