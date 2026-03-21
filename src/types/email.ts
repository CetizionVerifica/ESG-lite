
export type EmailJobCategorySummary = {
  categoryName: string;
  count: number;
};

export type EmailJob =
  | {
      type: "APPROVED" | "REJECTED";
      email: string;
      name: string;
      retryCount: number;
      categoryName?: string;
      siteName?: string;
      comment?: string;
    }
  | {
      type: "BULK_APPROVED" | "BULK_REJECTED";
      email: string;
      name: string;
      retryCount: number;
      totalCount: number;
      categories: EmailJobCategorySummary[];
      comment?: string;
    };