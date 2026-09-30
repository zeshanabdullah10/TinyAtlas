from datetime import datetime, timezone

import pytest
from tinyatlas import sun

UTC = timezone.utc


def minutes_off(a: datetime, b: datetime) -> float:
    return abs((a - b).total_seconds()) / 60


def test_london_midsummer_sunrise_and_sunset():
    # published times for London, 21 June 2024: sunrise 04:43 BST, sunset 21:21 BST
    rise, set_ = sun.rise_set(datetime(2024, 6, 21, tzinfo=UTC), 51.5074, -0.1278)
    assert minutes_off(rise, datetime(2024, 6, 21, 3, 43, tzinfo=UTC)) < 2
    assert minutes_off(set_, datetime(2024, 6, 21, 20, 21, tzinfo=UTC)) < 2


def test_noon_sun_is_due_south_at_the_expected_height():
    lat, lon = 36.333, 74.666                                   # Karimabad, Hunza
    noon = sun.solar_noon(datetime(2026, 3, 20, tzinfo=UTC), lon)
    az, alt = sun.position(noon, lat, lon)
    assert abs(az - 180) < 1 and abs(alt - (90 - lat)) < 1      # equinox: 90 minus the latitude
    az, alt = sun.position(sun.solar_noon(datetime(2026, 6, 21, tzinfo=UTC), lon), lat, lon)
    assert abs(alt - (90 - lat + 23.44)) < 0.5                  # solstice: plus the tilt


def test_morning_sun_is_in_the_east_and_rises_through_the_day():
    lat, lon = 36.333, 74.666
    az9, alt9 = sun.position(datetime(2026, 6, 21, 4, 0, tzinfo=UTC), lat, lon)   # 09:00 in Pakistan
    az10, alt10 = sun.position(datetime(2026, 6, 21, 5, 0, tzinfo=UTC), lat, lon)
    assert 60 < az9 < 120 and alt10 > alt9 > 20


def test_golden_hour_sits_inside_the_day():
    day = datetime(2026, 10, 12, tzinfo=UTC)
    rise, set_ = sun.rise_set(day, 36.333, 74.666)
    g_start, g_end = sun.rise_set(day, 36.333, 74.666, alt=6)
    assert rise < g_start < g_end < set_
    assert 30 < (g_start - rise).total_seconds() / 60 < 60


def test_polar_night_has_no_sunrise():
    assert sun.rise_set(datetime(2026, 12, 21, tzinfo=UTC), 78.2, 15.6) == (None, None)       # Svalbard


@pytest.mark.parametrize("hour", [0, 6, 12, 18])
def test_altitude_is_bounded(hour):
    az, alt = sun.position(datetime(2026, 1, 1, hour, tzinfo=UTC), 36.3, 74.7)
    assert 0 <= az < 360 and -90 <= alt <= 90
