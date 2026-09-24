"""Weather from Open-Meteo (free, no account or API key). Needs internet."""
from __future__ import annotations

from typing import Any

import httpx

CODES = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "light showers", 81: "showers",
    82: "heavy showers", 85: "snow showers", 86: "heavy snow showers", 95: "thunderstorms",
    96: "thunderstorms with hail", 99: "thunderstorms with hail",
}


async def get_weather(client: httpx.AsyncClient, location: str, units: str = "imperial") -> dict[str, Any]:
    location = (location or "").strip()
    if not location:
        return {"error": "Which city? (You can set your home city in Settings → Integrations)"}
    try:
        geo = await client.get("https://geocoding-api.open-meteo.com/v1/search",
                               params={"name": location.split(",")[0], "count": 5, "format": "json"}, timeout=10)
        places = geo.json().get("results") or []
        if not places:
            return {"error": f"Couldn't find a place called '{location}'"}
        # prefer a match on the region/country the user typed, e.g. "Springfield, IL"
        hint = location.split(",")[1].strip().lower() if "," in location else ""
        place = next((p for p in places if hint and hint in f"{p.get('admin1', '')} {p.get('country', '')} {p.get('country_code', '')}".lower()), places[0])
        imperial = units != "metric"
        fc = await client.get("https://api.open-meteo.com/v1/forecast", params={
            "latitude": place["latitude"], "longitude": place["longitude"], "timezone": "auto", "forecast_days": 3,
            "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "temperature_unit": "fahrenheit" if imperial else "celsius",
            "wind_speed_unit": "mph" if imperial else "kmh",
        }, timeout=10)
        data = fc.json()
    except (httpx.HTTPError, ValueError) as exc:
        return {"error": f"Weather unavailable — are you online? ({exc.__class__.__name__})"}
    t = "°F" if imperial else "°C"
    cur = data.get("current", {})
    daily = data.get("daily", {})
    days = []
    for i, day in enumerate(daily.get("time", [])):
        days.append({
            "date": day,
            "summary": CODES.get(daily["weather_code"][i], "mixed"),
            "high": f"{round(daily['temperature_2m_max'][i])}{t}",
            "low": f"{round(daily['temperature_2m_min'][i])}{t}",
            "chance_of_rain": f"{daily['precipitation_probability_max'][i]}%",
        })
    name = ", ".join(x for x in (place.get("name"), place.get("admin1"), place.get("country_code")) if x)
    return {
        "location": name,
        "now": {
            "summary": CODES.get(cur.get("weather_code"), "unknown"),
            "temperature": f"{round(cur.get('temperature_2m', 0))}{t}",
            "feels_like": f"{round(cur.get('apparent_temperature', 0))}{t}",
            "wind": f"{round(cur.get('wind_speed_10m', 0))} {'mph' if imperial else 'km/h'}",
            "humidity": f"{cur.get('relative_humidity_2m')}%",
        },
        "forecast": days,
    }
