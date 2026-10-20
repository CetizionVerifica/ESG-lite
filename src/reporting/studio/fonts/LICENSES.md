# Studio fonts (DS-1, R12)

The Design Studio renderer uses only these faces. Each is the Latin subset
WOFF2 from its `@fontsource` package (pinned to an exact version in
`package.json`), served at `GET /studio/fonts/<id>-<weight>.woff2` and inlined
into render jobs. No client font uploads (D3).

| FontId | Family | Package | Licence |
|---|---|---|---|
| `source-serif-4` | Source Serif 4 | `@fontsource/source-serif-4@5.3.0` | SIL Open Font License 1.1 |
| `source-sans-3` | Source Sans 3 | `@fontsource/source-sans-3@5.3.0` | SIL Open Font License 1.1 |
| `dm-serif-display` | DM Serif Display | `@fontsource/dm-serif-display@5.3.0` | SIL Open Font License 1.1 |
| `ibm-plex-sans` | IBM Plex Sans | `@fontsource/ibm-plex-sans@5.3.0` | SIL Open Font License 1.1 |
| `ibm-plex-serif` | IBM Plex Serif | `@fontsource/ibm-plex-serif@5.3.0` | SIL Open Font License 1.1 |
| `archivo` | Archivo | `@fontsource/archivo@5.3.0` | SIL Open Font License 1.1 |
| `fraunces` | Fraunces | `@fontsource/fraunces@5.3.0` | SIL Open Font License 1.1 |
| `noto-sans` | Noto Sans (fallback for missing glyphs) | `@fontsource/noto-sans@5.3.0` | SIL Open Font License 1.1 |

The full licence text ships inside each package (`node_modules/@fontsource/<id>/LICENSE`).
Devanagari (Noto Sans Devanagari, R14) is not bundled yet.
