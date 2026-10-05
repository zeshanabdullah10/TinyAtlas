// Live conditions at the site from Open-Meteo (free, no key, CORS enabled). The model forecast is downscaled to the
// lake's own height, and the page says it is a forecast, not a measurement.
const WMO = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "showers", 81: "showers", 82: "heavy showers",
  85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail",
};

export class Weather {
  constructor(lat, lon, elevation) { this.lat = lat; this.lon = lon; this.el = elevation; this.data = null; }
  async load() {
    const u = new URL("https://api.open-meteo.com/v1/forecast");
    Object.entries({
      latitude: this.lat.toFixed(4), longitude: this.lon.toFixed(4), elevation: Math.round(this.el),
      current: "temperature_2m,weather_code,wind_speed_10m", daily: "temperature_2m_max,temperature_2m_min,weather_code",
      timezone: "Asia/Karachi", forecast_days: 3,
    }).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const d = this.data = await r.json();
    const c = d.current, day = d.daily;
    const t = (v) => `${Math.round(v)} °C`;
    const days = day.time.slice(1, 3).map((date, i) => {
      const name = new Date(`${date}T12:00:00`).toLocaleDateString("en", { weekday: "short" });
      return `${name} ${Math.round(day.temperature_2m_min[i + 1])}–${t(day.temperature_2m_max[i + 1])}`;
    });
    return `<b>Now at the lake:</b> ${t(c.temperature_2m)}, ${WMO[c.weather_code] || "—"}, wind ${Math.round(c.wind_speed_10m)} km/h. ` +
      `Today ${Math.round(day.temperature_2m_min[0])}–${t(day.temperature_2m_max[0])} · ${days.join(" · ")}<br>` +
      `<small>Forecast by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> for ${Math.round(this.el).toLocaleString("en")} m, not a measurement.</small>`;
  }
}
