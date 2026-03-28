
export type EmailJobCategorySummary = {
  categoryName: string;
  count: number;
};

// Manager/submitter info for transparency in emails
export type EmailActionInfo = {
  managerName?: string;
  managerEmail?: string;
  managerRole?: string;
  submitterName?: string;
  submitterEmail?: string;
  deepLink?: string; // Frontend path, e.g. "/my-emissions"
};

export type EmailJob =
  | ({
      type: "APPROVED" | "REJECTED";
      email: string;
      name: string;
      retryCount: number;
      categoryName?: string;
      siteName?: string;
      comment?: string;
    } & EmailActionInfo)
  | ({
      type: "BULK_APPROVED" | "BULK_REJECTED";
      email: string;
      name: string;
      retryCount: number;
      totalCount: number;
      categories: EmailJobCategorySummary[];
      comment?: string;
    } & EmailActionInfo)
  | ({
      type: "PRODUCTION_APPROVED" | "PRODUCTION_REJECTED";
      email: string;
      name: string;
      retryCount: number;
      productName?: string;
      siteName?: string;
      comment?: string;
    } & EmailActionInfo)
  | ({
      type: "BULK_PRODUCTION_APPROVED" | "BULK_PRODUCTION_REJECTED";
      email: string;
      name: string;
      retryCount: number;
      totalCount: number;
      products: EmailJobCategorySummary[];
      comment?: string;
    } & EmailActionInfo)
  | {
      type: "DEADLINE_REMINDER";
      email: string;
      name: string;
      retryCount: number;
      month: string;
      year: number;
      siteName?: string;
    }
  | {
      type: "DEADLINE_ESCALATION";
      email: string;
      name: string;
      retryCount: number;
      month: string;
      year: number;
      pendingUsers: { name: string; email: string; role: string; siteName: string }[];
    };
