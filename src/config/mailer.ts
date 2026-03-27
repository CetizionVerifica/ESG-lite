import Mailgun from "mailgun.js";
import formData from "form-data";
import dotenv from "dotenv";

dotenv.config();

const mailgun = new Mailgun(formData);

export const mg = mailgun.client({
  username: "api",
  key: process.env.MAILGUN_API_KEY || "",
});

export const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || "mail.carbon-lens.com";
