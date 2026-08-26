import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import localStorage from "./localStorage";

dotenv.config();

// Local development: store uploaded documents on disk instead of Cloudinary.
// Set LOCAL_FILE_STORAGE=true in .env. Unset it and this file behaves exactly
// as it did before — the real SDK, configured from CLOUDINARY_* env vars.
const useLocalStorage = process.env.LOCAL_FILE_STORAGE === "true";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

if (useLocalStorage) {
  console.log("📁 Local file storage active — uploads stay on this machine");
}

export default (useLocalStorage ? localStorage : cloudinary) as typeof cloudinary;
