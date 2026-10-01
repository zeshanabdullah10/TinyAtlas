// Where the sun is: a line-for-line port of backend/tinyatlas/sun.py (NOAA equations). Keep the two in step.
// Times are JS Dates (absolute instants); azimuth is degrees clockwise from north, altitude degrees above the horizon.

const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
export const RISE_ALT = -0.833;

const julianCentury = (t) => (t.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525.0;

function declinationAndEot(jc) {
  const l0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const mr = rad(m);
  const c = Math.sin(mr) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(2 * mr) * (0.019993 - 0.000101 * jc)
    + Math.sin(3 * mr) * 0.000289;
  const app = l0 + c - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * jc));
  let obliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  obliq += 0.00256 * Math.cos(rad(125.04 - 1934.136 * jc));
  const decl = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(app))));
  const y = Math.tan(rad(obliq / 2)) ** 2, l0r = rad(l0);
  const eot = 4 * deg(y * Math.sin(2 * l0r) - 2 * e * Math.sin(mr) + 4 * e * y * Math.sin(mr) * Math.cos(2 * l0r)
    - 0.5 * y * y * Math.sin(4 * l0r) - 1.25 * e * e * Math.sin(2 * mr));
  return [decl, eot];
}

/** [azimuth, altitude] in degrees at instant t. */
export function sunPosition(t, lat, lon) {
  const [decl, eot] = declinationAndEot(julianCentury(t));
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60;
  const ha = rad((minutes + eot + 4 * lon) / 4 - 180), latr = rad(lat), dr = rad(decl);
  const cosZen = Math.sin(latr) * Math.sin(dr) + Math.cos(latr) * Math.cos(dr) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const az = deg(Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(latr) - Math.tan(dr) * Math.cos(latr))) + 180;
  return [((az % 360) + 360) % 360, 90 - deg(zen)];
}

/** Solar noon on the UTC calendar day of `day`. */
export function solarNoon(day, lon) {
  const d0 = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  let t = new Date(d0 + (720 - 4 * lon) * 60000);
  for (let i = 0; i < 2; i++) t = new Date(d0 + (720 - 4 * lon - declinationAndEot(julianCentury(t))[1]) * 60000);
  return t;
}

/** [rise, set] when the sun crosses `alt` degrees on that day, or [null, null] in polar day or night. */
export function riseSet(day, lat, lon, alt = RISE_ALT) {
  const noon = solarNoon(day, lon), out = [];
  for (const sign of [-1, 1]) {
    let t = noon;
    for (let i = 0; i < 3; i++) {
      const [decl] = declinationAndEot(julianCentury(t)), latr = rad(lat), dr = rad(decl);
      const cosHa = (Math.sin(rad(alt)) - Math.sin(latr) * Math.sin(dr)) / (Math.cos(latr) * Math.cos(dr));
      if (Math.abs(cosHa) > 1) return [null, null];
      t = new Date(noon.getTime() + sign * 4 * deg(Math.acos(cosHa)) * 60000);
    }
    out.push(t);
  }
  return out;
}

/** Minutes the place's clock is ahead of UTC at instant t: from its IANA zone when known, else from longitude. */
export function utcOffsetMin(t, tz, lon) {
  if (tz) {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric",
        day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(t).map((x) => [x.type, +x.value]));
      return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(t.getTime() / 60000) * 60000) / 60000);
    } catch { /* unknown zone: fall through */ }
  }
  return Math.round(lon / 15) * 60;
}

/** The instant when the place's clock reads `minutes` after midnight on local date (y, m 0-based, d). */
export function localInstant(y, m, d, minutes, tz, lon) {
  const guess = Date.UTC(y, m, d, 0, minutes);
  return new Date(guess - utcOffsetMin(new Date(guess), tz, lon) * 60000);
}

/** "06:42" on the place's clock. */
export function clock(t, tz, lon) {
  if (!t) return "–";
  const local = new Date(t.getTime() + utcOffsetMin(t, tz, lon) * 60000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}
