import Mailgun from "mailgun.js";
import formData from "form-data";

const mailgun = new Mailgun(formData);

export const mg = mailgun.client({
  username: "api",
  key: "b4f53d2d9e64b305e6dcd0982918b444-5dcb5e36-033ea26c"
});
// 
export const MAILGUN_DOMAIN ="mail.carbon-lens.com";