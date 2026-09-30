"""Where the sun is: NOAA's solar position equations (accurate to about a minute for sunrise and sunset).

web/js/sun.js is a line-for-line port; keep the two in step. Times are UTC datetimes; azimuth is degrees clockwise
from north, altitude degrees above the horizon (true geometric position, no refraction). Sunrise and sunset use the
standard -0.833 degree altitude (refraction plus the sun's radius) on a flat horizon; mountains are handled by
the terrain shadows, not here.
"""
import math
from datetime import datetime, timedelta, timezone

RISE_ALT = -0.833


def _julian_century(t: datetime) -> float:
    jd = t.timestamp() / 86400.0 + 2440587.5
    return (jd - 2451545.0) / 36525.0


def _declination_and_eot(jc: float) -> tuple[float, float]:
    """(solar declination in degrees, equation of time in minutes)."""
    l0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360
    m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)
    e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)
    mr = math.radians(m)
    c = (math.sin(mr) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + math.sin(2 * mr) * (0.019993 - 0.000101 * jc)
         + math.sin(3 * mr) * 0.000289)
    app = l0 + c - 0.00569 - 0.00478 * math.sin(math.radians(125.04 - 1934.136 * jc))
    obliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60
    obliq += 0.00256 * math.cos(math.radians(125.04 - 1934.136 * jc))
    decl = math.degrees(math.asin(math.sin(math.radians(obliq)) * math.sin(math.radians(app))))
    y = math.tan(math.radians(obliq / 2)) ** 2
    l0r = math.radians(l0)
    eot = 4 * math.degrees(y * math.sin(2 * l0r) - 2 * e * math.sin(mr) + 4 * e * y * math.sin(mr) * math.cos(2 * l0r)
                           - 0.5 * y * y * math.sin(4 * l0r) - 1.25 * e * e * math.sin(2 * mr))
    return decl, eot


def position(t: datetime, lat: float, lon: float) -> tuple[float, float]:
    """(azimuth, altitude) in degrees for UTC time t at lat, lon."""
    decl, eot = _declination_and_eot(_julian_century(t))
    minutes = t.hour * 60 + t.minute + t.second / 60
    ha = (minutes + eot + 4 * lon) / 4 - 180                 # hour angle, degrees
    latr, dr, har = math.radians(lat), math.radians(decl), math.radians(ha)
    cos_zen = math.sin(latr) * math.sin(dr) + math.cos(latr) * math.cos(dr) * math.cos(har)
    zen = math.acos(max(-1.0, min(1.0, cos_zen)))
    az = math.degrees(math.atan2(math.sin(har), math.cos(har) * math.sin(latr) - math.tan(dr) * math.cos(latr))) + 180
    return az % 360, 90 - math.degrees(zen)


def solar_noon(day: datetime, lon: float) -> datetime:
    """UTC time of solar noon on the UTC calendar day of `day` (two passes: the equation of time moves a little)."""
    d0 = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    t = d0 + timedelta(minutes=720 - 4 * lon)
    for _ in range(2):
        t = d0 + timedelta(minutes=720 - 4 * lon - _declination_and_eot(_julian_century(t))[1])
    return t


def rise_set(day: datetime, lat: float, lon: float, alt: float = RISE_ALT):
    """(rise, set) UTC datetimes when the sun crosses `alt` degrees, or (None, None) in polar day/night.
    alt=RISE_ALT gives sunrise/sunset; alt=6 gives the end/start of the golden hour."""
    noon = solar_noon(day, lon)
    out = []
    for sign in (-1, 1):
        t = noon
        for _ in range(3):                                   # refine with the declination at the event itself
            decl, _eot = _declination_and_eot(_julian_century(t))
            latr, dr = math.radians(lat), math.radians(decl)
            cos_ha = (math.sin(math.radians(alt)) - math.sin(latr) * math.sin(dr)) / (math.cos(latr) * math.cos(dr))
            if abs(cos_ha) > 1:
                return None, None
            t = noon + timedelta(minutes=sign * 4 * math.degrees(math.acos(cos_ha)))
        out.append(t)
    return out[0], out[1]
