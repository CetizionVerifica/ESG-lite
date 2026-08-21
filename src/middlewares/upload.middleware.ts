// Multer reports client-fixable upload problems (file too large, unexpected
// field) as errors. Without handling they reach Express's default handler and
// surface as an opaque HTML 500, so wrap the parser and translate them to 400.
import { RequestHandler } from "express";
import multer from "multer";

const messageFor = (error: multer.MulterError): string => {
    switch (error.code) {
        case "LIMIT_FILE_SIZE":
            return "File is too large (maximum 10MB)";
        case "LIMIT_UNEXPECTED_FILE":
            return `Unexpected file field: ${error.field}`;
        default:
            return `Upload failed: ${error.message}`;
    }
};

/** Runs `parser`, converting multer's own errors into 400 responses. */
export const withUploadErrors =
    (parser: RequestHandler): RequestHandler =>
    (req, res, next) =>
        parser(req, res, (error: unknown) => {
            if (error instanceof multer.MulterError) {
                res.status(400).json({ message: messageFor(error) });
                return;
            }
            next(error);
        });
