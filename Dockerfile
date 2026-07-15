# ESG-lite backend image.
#
# Based on the official Playwright image because the GHG report renderer launches
# headless Chromium (Playwright + Paged.js) to produce PDFs. This image ships
# Chromium AND all of its system libraries preinstalled — which the plain Node
# buildpack cannot provide (installing them needs root/apt at build time).
#
# The tag MUST match the `playwright` version in package.json (1.61.1) so the
# preinstalled browser matches the client library. If this tag 404s at build,
# try the `-jammy` suffix or a nearby patch version.
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

# Install ALL deps incl. devDependencies (TypeScript, etc.) so `npm run build`
# works even though NODE_ENV=production is set at build time by the platform.
COPY package*.json ./
RUN npm ci --include=dev

# Copy source and compile TypeScript -> dist/
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
