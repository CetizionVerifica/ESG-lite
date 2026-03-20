export const successTemplate = (name: string) => ({
    subject: "Submission Approved 🎉",
    html: `<h2>Hello ${name}</h2><p>Your submission has been approved.</p>`,
});

export const rejectTemplate = (name: string) => ({
    subject: "Submission Rejected ❌",
    html: `<h2>Hello ${name}</h2><p>Your submission was rejected.</p>`,
});

export const failureTemplate = (email: string) => ({
    subject: "Email Failed ⚠️",
    html: `<h3>Failed to send email to ${email}</h3>`,
});