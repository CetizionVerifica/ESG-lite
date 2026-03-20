export type EmailJob = {
    type: "APPROVED" | "REJECTED";
    email: string;
    name: string;
    retryCount: number;
};