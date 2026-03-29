import Mailgun from "mailgun.js";
import formData from "form-data";
import dotenv from "dotenv";

dotenv.config();

const mailgun = new Mailgun(formData);

let _mg: ReturnType<typeof mailgun.client> | null = null;

export function getMg() {
  if (!_mg) {
    const key = process.env.MAILGUN_API_KEY;
    if (!key) {
      console.warn("MAILGUN_API_KEY not set — email sending will be disabled");
      return null;
    }
    _mg = mailgun.client({ username: "api", key });
  }
  return _mg;
}

export const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || "mail.carbon-lens.com";
