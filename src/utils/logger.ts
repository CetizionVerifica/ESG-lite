/**
 * Simple structured logger — outputs JSON-like lines that PM2 timestamps.
 * No external dependencies. Easy to grep/search in log files.
 *
 * Usage:
 *   log.info("Emission", "Created emission #42", { userId: 5, siteId: 3 })
 *   log.error("Auth", "Login failed", { email: "x@y.com", reason: "bad password" })
 *   log.warn("Upload", "Skipped duplicate row", { row: 5 })
 */

type LogLevel = "INFO" | "WARN" | "ERROR";

function write(level: LogLevel, category: string, message: string, meta?: Record<string, any>) {
  const entry = meta
    ? `[${level}] [${category}] ${message} ${JSON.stringify(meta)}`
    : `[${level}] [${category}] ${message}`;

  if (level === "ERROR") {
    console.error(entry);
  } else if (level === "WARN") {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}

export const log = {
  info: (category: string, message: string, meta?: Record<string, any>) =>
    write("INFO", category, message, meta),
  warn: (category: string, message: string, meta?: Record<string, any>) =>
    write("WARN", category, message, meta),
  error: (category: string, message: string, meta?: Record<string, any>) =>
    write("ERROR", category, message, meta),
};
