/** target_off_track (attention): at least one KPI target off track (I6); first = the worst on the wall. */
import { card, type Rule } from "./card";
import { TARGET_OFF_TRACK_MIN } from "./thresholds";

export const target_off_track: Rule = (f) => {
  const off = (f.targetWall?.items ?? []).filter((i) => i.source === "kpi" && i.status === "off_track");
  if (off.length < TARGET_OFF_TRACK_MIN) return null;
  // The wall is already sorted worst first (off_track, then expected − progress).
  return card("target_off_track", "attention", { count: off.length, first_name: off[0].name }, off.length === 1 ? off[0].link : "/kpi/targets", "target_wall");
};
