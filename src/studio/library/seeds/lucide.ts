/**
 * DS-4 · the Lucide subset (ISC, lucide-static 0.563.0, the version the FE's
 * lucide-react uses) offered in the Elements drawer, by theme. The build
 * script (src/scripts/buildStudioSeeds.ts) reads lucide-static's icon nodes
 * for these names and writes render/iconsLucide.ts (the renderer's copy) and
 * data/studio/elements/icons.json. Element names are `lucide:<name>`.
 */
export const LUCIDE_THEMES: Record<string, string[]> = {
  nature: [
    "leaf", "leafy-green", "sprout", "tree-deciduous", "tree-pine", "trees", "tree-palm", "shrub", "flower", "flower-2", "clover", "wheat", "vegan",
    "droplet", "droplets", "droplet-off", "waves", "mountain", "mountain-snow", "earth", "globe", "earth-lock", "land-plot", "fence", "fish", "bird", "bug", "paw-print",
  ],
  climate: [
    "cloud", "cloud-rain", "cloud-sun", "cloud-snow", "cloud-lightning", "cloud-off", "cloud-fog", "cloudy", "haze", "tornado", "rainbow", "sun", "sun-medium", "sunrise", "sunset",
    "moon", "wind", "snowflake", "thermometer", "thermometer-sun", "thermometer-snowflake", "umbrella",
  ],
  energy: [
    "zap", "zap-off", "battery", "battery-charging", "battery-full", "plug", "plug-zap", "power", "lightbulb", "lamp", "solar-panel", "atom", "radiation", "gauge", "fuel", "flame",
    "heater", "fan", "air-vent", "cable",
  ],
  transport: [
    "car", "car-front", "bus", "bus-front", "truck", "train-front", "tram-front", "plane", "plane-takeoff", "plane-landing", "ship", "sailboat", "bike", "footprints", "forklift", "tractor",
    "route", "map", "map-pin", "navigation", "compass", "anchor", "container", "baggage-claim", "ticket",
  ],
  industry: [
    "factory", "warehouse", "building", "building-2", "store", "landmark", "hotel", "house", "construction", "hammer", "wrench", "cog", "settings", "drill", "pickaxe", "shovel", "hard-hat",
    "package", "package-open", "box", "boxes", "recycle", "trash", "trash-2", "beaker", "flask-conical", "test-tube", "microscope", "dna", "biohazard", "fire-extinguisher", "siren",
    "refrigerator", "washing-machine", "shower-head", "bath", "toilet", "printer", "server", "cpu", "database",
  ],
  people: [
    "users", "user", "user-check", "user-plus", "users-round", "baby", "graduation-cap", "school", "book", "book-open", "heart", "heart-handshake", "heart-pulse", "hand", "hand-heart",
    "handshake", "stethoscope", "hospital", "pill", "syringe", "accessibility", "armchair", "cigarette-off", "shirt", "glasses", "apple", "carrot", "salad", "utensils", "coffee",
  ],
  governance: [
    "shield", "shield-check", "shield-alert", "scale", "gavel", "badge-check", "award", "medal", "trophy", "star", "flag", "target", "crosshair", "briefcase", "banknote", "coins",
    "piggy-bank", "wallet", "receipt", "credit-card", "dollar-sign", "euro", "indian-rupee", "percent", "badge-percent", "lock", "lock-open", "key", "eye", "globe-lock", "scroll-text",
    "file-text", "file-check", "clipboard-check", "list-checks", "megaphone",
  ],
  data: [
    "chart-bar", "chart-line", "chart-pie", "chart-column", "chart-area", "trending-up", "trending-down", "activity", "calculator", "sigma", "infinity", "equal", "plus", "minus",
    "layers", "layout-grid", "network", "share-2", "git-branch", "workflow", "presentation", "sheet", "table", "list", "clipboard", "clipboard-list", "file", "files", "folder",
    "calendar", "clock", "timer", "hourglass", "history",
  ],
  general: [
    "check", "circle-check", "x", "circle-x", "triangle-alert", "circle-alert", "info", "search", "link", "mail", "phone", "message-circle", "bell", "wifi", "smartphone", "laptop",
    "monitor", "camera", "image", "video", "mic", "arrow-right", "arrow-left", "arrow-up", "arrow-down", "arrow-up-right", "arrow-down-right", "refresh-cw", "rotate-cw", "repeat",
    "move", "puzzle", "rocket", "sparkles", "gem", "crown", "lightbulb", "bookmark", "tag", "gift", "newspaper", "notebook", "palette", "pencil", "ruler", "scissors", "tent",
  ],
};

/** Every icon once, in theme order. */
export const LUCIDE_NAMES = (): string[] => [...new Set(Object.values(LUCIDE_THEMES).flat())];
