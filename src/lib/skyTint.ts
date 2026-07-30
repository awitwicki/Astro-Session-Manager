export interface SkyTintLevels { day: number; twilight: number }

/** Normalized 0..1 sky-tint layer levels from the sun's altitude (degrees).
 *  `day` ramps over 0..15° above the horizon; `twilight` peaks at sunset,
 *  fades to 0 at -18° (astronomical night), and is complementary to `day`
 *  above the horizon. Stylized — not photometric. */
export function skyTintLevels(sunAltDeg: number): SkyTintLevels {
  const day = Math.min(1, Math.max(0, sunAltDeg / 15))
  const twilight = sunAltDeg >= 0
    ? 1 - day
    : Math.min(1, Math.max(0, 1 + sunAltDeg / 18))
  return { day, twilight }
}
