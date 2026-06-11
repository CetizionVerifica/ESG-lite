import { User } from "../entities/User";

/**
 * Restrict each of the user's sites to the categories the user is allowed to
 * see (via user_categories), and strip the raw grant list from the response.
 *
 * Mirrors the access rules used at login:
 *  - An empty grant set = legacy/full access → show all site categories.
 *  - A non-empty grant set = explicit subset → show only granted categories.
 *
 * Mutates the passed user in place (response-shaping of a loaded entity).
 */
export const filterUserSiteCategories = (user: User): void => {
  const userCategories = user.categories || [];

  if (userCategories.length > 0) {
    const allowedIds = new Set(userCategories.map((c) => c.category_id));

    if (user.sites?.length > 0) {
      user.sites.forEach((site) => {
        site.categories = (site.categories || []).filter((c) => allowedIds.has(c.category_id));
      });
    }
    if (user.site?.categories) {
      user.site.categories = user.site.categories.filter((c) => allowedIds.has(c.category_id));
    }
  }

  // Frontend doesn't need the raw grant list.
  delete (user as any).categories;

  // Never expose credential material to the client.
  delete (user as any).password;
  delete (user as any).password_reset_token;
  delete (user as any).password_reset_expires;
};
