import { Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { sendPasswordResetEmail } from "../services/emailService";

const userRepository = AppDataSource.getRepository(User);

/**
 * Forgot Password - Send password reset email
 * POST /api/auth/forgot-password
 * Body: { email: string }
 */
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Find user by email
    const user = await userRepository.findOne({ where: { email } });

    // Always return success message to prevent email enumeration
    if (!user) {
      return res.status(200).json({
        message: "If an account with that email exists, a password reset link has been sent.",
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");

    // Hash the token before storing (for security)
    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    // Set token and expiry (1 hour from now)
    user.password_reset_token = hashedToken;
    user.password_reset_expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await userRepository.save(user);

    // Send password reset email with the unhashed token
    try {
      await sendPasswordResetEmail(user.email, resetToken, user.name);
    } catch (emailError) {
      // If email fails, clear the token
      user.password_reset_token = null as any; // null, not undefined: save() skips undefined
      user.password_reset_expires = null as any;
      await userRepository.save(user);

      console.error("Failed to send password reset email:", emailError);
      return res.status(500).json({
        message: "Failed to send password reset email. Please try again later.",
      });
    }

    res.status(200).json({
      message: "If an account with that email exists, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "An error occurred. Please try again later." });
  }
};

/**
 * Reset Password - Reset the password using the token
 * POST /api/auth/reset-password
 * Body: { token: string, password: string }
 */
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: "Token and password are required" });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters long" });
    }

    // Hash the incoming token to compare with stored hash
    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    // Find user with valid (non-expired) reset token
    const user = await userRepository
      .createQueryBuilder("user")
      .where("user.password_reset_token = :token", { token: hashedToken })
      .andWhere("user.password_reset_expires > :now", { now: new Date() })
      .getOne();

    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired password reset token. Please request a new one.",
      });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password and clear reset token fields
    user.password = hashedPassword;
    user.password_reset_token = null as any; // null, not undefined: save() skips undefined
    user.password_reset_expires = null as any;

    await userRepository.save(user);

    res.status(200).json({ message: "Password has been reset successfully. You can now log in with your new password." });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "An error occurred. Please try again later." });
  }
};

/**
 * Verify Reset Token - Check if a reset token is valid
 * GET /api/auth/verify-reset-token/:token
 */
export const verifyResetToken = async (req: Request, res: Response) => {
  try {
    const { token }: any = req.params;

    if (!token) {
      return res.status(400).json({ valid: false, message: "Token is required" });
    }

    // Hash the incoming token to compare with stored hash
    const hashedToken = crypto
      .createHash("sha256")
      .update(token as string)
      .digest("hex");

    // Find user with valid (non-expired) reset token
    const user = await userRepository
      .createQueryBuilder("user")
      .where("user.password_reset_token = :token", { token: hashedToken })
      .andWhere("user.password_reset_expires > :now", { now: new Date() })
      .getOne();

    if (!user) {
      return res.status(400).json({
        valid: false,
        message: "Invalid or expired password reset token.",
      });
    }

    res.status(200).json({ valid: true, message: "Token is valid" });
  } catch (error) {
    console.error("Verify reset token error:", error);
    res.status(500).json({ valid: false, message: "An error occurred" });
  }
};
