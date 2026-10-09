import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { Site } from "../entities/Site";
import { Category } from "../entities/Category";
import { Emission } from "../entities/Emission";
import { yearlyCoversDateSql } from "./reportingPeriod";

/** User relations needed by contributorSiteCategories. */
export const CONTRIBUTOR_RELATIONS = ["site", "site.categories", "sites", "sites.categories", "categories"];

const pad = (n: number) => String(n).padStart(2, "0");

/** First and last day of a month as YYYY-MM-DD. */
export const monthBounds = (year: number, month: number) => ({
  monthStart: `${year}-${pad(month)}-01`,
  monthEnd: `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`,
});

/**
 * The categories a contributor owes per site: each of their sites' categories
 * narrowed by their grants (an empty grant list means all), without FERA (FERA
 * rows are generated from their parent entry). Loaded with CONTRIBUTOR_RELATIONS.
 */
export const contributorSiteCategories = (user: User): { site: Site; categories: Category[] }[] => {
  const granted = new Set((user.categories || []).map((c) => c.category_id));
  const sites = [user.site, ...(user.sites || [])]
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .filter((s, i, all) => all.findIndex((o) => o.site_id === s.site_id) === i)
    .sort((a, b) => a.site_id - b.site_id);

  return sites.map((site) => ({
    site,
    categories: (site.categories || [])
      .filter((c) => c.category_name?.toLowerCase() !== "fera")
      .filter((c) => granted.size === 0 || granted.has(c.category_id))
      .sort((a, b) => (a.scope ?? "~").localeCompare(b.scope ?? "~") || a.category_name.localeCompare(b.category_name)),
  }));
};

/**
 * Per site, the contributor's categories with nothing filed for the month:
 * no monthly entry dated in it and no yearly batch covering it, whoever filed
 * them. This is the "todo" status of GET /user/my-month. Sites with nothing
 * outstanding are left out.
 */
export const outstandingForMonth = async (
  user: User,
  year: number,
  month: number,
): Promise<{ site: Site; categories: Category[] }[]> => {
  const siteCategories = contributorSiteCategories(user).filter((s) => s.categories.length);
  if (!siteCategories.length) return [];

  const { monthStart, monthEnd } = monthBounds(year, month);
  const siteIds = siteCategories.map((s) => s.site.site_id);
  const categoryIds = [...new Set(siteCategories.flatMap((s) => s.categories.map((c) => c.category_id)))];

  const filed = await AppDataSource.getRepository(Emission)
    .createQueryBuilder("e")
    .select("DISTINCT e.site_id", "site_id")
    .addSelect("e.category_id", "category_id")
    .where("e.site_id IN (:...siteIds)", { siteIds })
    .andWhere("e.category_id IN (:...categoryIds)", { categoryIds })
    .andWhere(
      `((e.reporting_period <> 'yearly' AND e.date_of_reporting BETWEEN :monthStart AND :monthEnd)
        OR ${yearlyCoversDateSql("e")})`,
      { monthStart, monthEnd, coveredDate: monthStart },
    )
    .getRawMany();
  const done = new Set(filed.map((r) => `${r.site_id}:${r.category_id}`));

  return siteCategories
    .map(({ site, categories }) => ({
      site,
      categories: categories.filter((c) => !done.has(`${site.site_id}:${c.category_id}`)),
    }))
    .filter((s) => s.categories.length);
};
