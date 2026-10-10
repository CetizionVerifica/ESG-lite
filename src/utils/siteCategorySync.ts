import { EntityManager } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Category } from "../entities/Category";

/**
 * When categories are newly assigned to a site, propagate them to the per-user
 * category access (user_categories) of users already on that site.
 *
 * Login (auth.controller) filters a site's categories down to the user's
 * granted set. Users whose grant set predates the assignment would never see
 * the new category without this sync.
 *
 * Users with an empty grant set are treated as full-access (legacy) and are
 * left untouched — they already see every site category. Existing grants are
 * preserved; we only append the newly added categories.
 *
 * Pass `manager` to run inside the caller's transaction.
 */
export const grantCategoriesToSiteUsers = async (
  siteId: number,
  newlyAddedCategories: Category[],
  manager: EntityManager = AppDataSource.manager
): Promise<void> => {
  if (newlyAddedCategories.length === 0) return;
  const userRepo = manager.getRepository(User);

  // Users on this site via single-site assignment OR multi-site (manager) link.
  const users = await userRepo
    .createQueryBuilder("user")
    .leftJoinAndSelect("user.categories", "category")
    .leftJoin("user.site", "site")
    .leftJoin("user.sites", "sites")
    .where("site.site_id = :siteId", { siteId })
    .orWhere("sites.site_id = :siteId", { siteId })
    .getMany();

  for (const user of users) {
    // Empty grant set = full access; appending would accidentally restrict them.
    if (!user.categories || user.categories.length === 0) continue;

    const existingIds = new Set(user.categories.map((c) => c.category_id));
    const toAdd = newlyAddedCategories.filter((c) => !existingIds.has(c.category_id));
    if (toAdd.length === 0) continue;

    user.categories = [...user.categories, ...toAdd];
    await userRepo.save(user);
  }
};
