export interface HourlyWeatherItem {
  time: string;
  status: string;
  temp: string;
  weatherCode: number;
}

export interface DailyForecastItem {
  day: string;
  status: string;
  tempRange: string;
  weatherCode: number;
}

export interface WeatherData {
  city: string;
  currentTempF: number;
  currentTempC: number;
  condition: string;
  humidity: number;
  windSpeedMph: number;
  weatherCode: number;
  timeline: HourlyWeatherItem[];
  dailyForecast: DailyForecastItem[];
}

export const WMO_WEATHER_MAP: Record<number, { condition: string; type: 'sun' | 'cloud' | 'rain' | 'snow' | 'thunder' | 'wind' }> = {
  0: { condition: 'Clear Sky', type: 'sun' },
  1: { condition: 'Mainly Clear', type: 'sun' },
  2: { condition: 'Partly Cloudy', type: 'cloud' },
  3: { condition: 'Overcast', type: 'cloud' },
  45: { condition: 'Foggy', type: 'cloud' },
  48: { condition: 'Depositing Rime Fog', type: 'cloud' },
  51: { condition: 'Light Drizzle', type: 'rain' },
  53: { condition: 'Moderate Drizzle', type: 'rain' },
  55: { condition: 'Dense Drizzle', type: 'rain' },
  61: { condition: 'Slight Rain', type: 'rain' },
  63: { condition: 'Moderate Rain', type: 'rain' },
  65: { condition: 'Heavy Rain', type: 'rain' },
  71: { condition: 'Slight Snow', type: 'snow' },
  73: { condition: 'Moderate Snow', type: 'snow' },
  75: { condition: 'Heavy Snow', type: 'snow' },
  80: { condition: 'Rain Showers', type: 'rain' },
  81: { condition: 'Moderate Rain Showers', type: 'rain' },
  82: { condition: 'Violent Rain Showers', type: 'rain' },
  95: { condition: 'Thunderstorm', type: 'thunder' },
  96: { condition: 'Thunderstorm with Hail', type: 'thunder' },
  99: { condition: 'Heavy Thunderstorm', type: 'thunder' },
};

export function getWeatherConditionInfo(code: number) {
  return WMO_WEATHER_MAP[code] || { condition: 'Partly Cloudy', type: 'cloud' as const };
}

export const DEFAULT_BANGALORE_COORDS = {
  lat: 12.9716,
  lon: 77.5946,
  name: 'Bangalore, India'
};

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, {
      headers: { 'Accept-Language': 'en' }
    });
    if (res.ok) {
      const data = await res.json();
      const city = data.address?.city || data.address?.town || data.address?.village || data.address?.county || data.address?.state_district;
      const country = data.address?.country || 'India';
      if (city) return `${city}, ${country}`;
    }
  } catch (e) {
    console.warn("Reverse geocode failed:", e);
  }
  return 'Bangalore, India';
}

export async function fetchLiveWeatherData(): Promise<WeatherData> {
  let lat = DEFAULT_BANGALORE_COORDS.lat;
  let lon = DEFAULT_BANGALORE_COORDS.lon;
  let cityName = DEFAULT_BANGALORE_COORDS.name;

  if (typeof window !== 'undefined' && 'geolocation' in navigator) {
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000, maximumAge: 600000 });
      });
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
      cityName = await reverseGeocode(lat, lon);
    } catch (err) {
      console.log("Geolocation unavailable or denied, defaulting to Bangalore:", err);
      lat = DEFAULT_BANGALORE_COORDS.lat;
      lon = DEFAULT_BANGALORE_COORDS.lon;
      cityName = DEFAULT_BANGALORE_COORDS.name;
    }
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Weather API error: ${res.statusText}`);
  }

  const data = await res.json();
  const current = data.current || {};
  const tempC = Math.round(current.temperature_2m ?? 24);
  const tempF = Math.round((tempC * 9 / 5) + 32);
  const code = current.weather_code ?? 0;
  const humidity = Math.round(current.relative_humidity_2m ?? 50);
  const windMph = Math.round((current.wind_speed_10m ?? 10) * 0.621371);
  const conditionInfo = getWeatherConditionInfo(code);

  // Hourly timeline for today (pick 5 time points: e.g., 08:00 AM, 11:00 AM, 02:00 PM, 05:00 PM, 08:00 PM)
  const hourlyTimes: string[] = data.hourly?.time || [];
  const hourlyTemps: number[] = data.hourly?.temperature_2m || [];
  const hourlyCodes: number[] = data.hourly?.weather_code || [];

  const targetHours = [8, 11, 14, 17, 20];
  const timeline: HourlyWeatherItem[] = [];

  targetHours.forEach(targetHour => {
    // Find matching hour index for today
    const index = hourlyTimes.findIndex(t => {
      const date = new Date(t);
      return date.getHours() === targetHour;
    });

    if (index !== -1 && index < hourlyTemps.length) {
      const hTempC = hourlyTemps[index];
      const hTempF = Math.round((hTempC * 9 / 5) + 32);
      const hCode = hourlyCodes[index] ?? code;
      const hCond = getWeatherConditionInfo(hCode).condition;

      const hour12 = targetHour % 12 === 0 ? 12 : targetHour % 12;
      const ampm = targetHour >= 12 ? 'PM' : 'AM';
      const timeStr = `${hour12.toString().padStart(2, '0')}:00 ${ampm}`;

      timeline.push({
        time: timeStr,
        status: hCond,
        temp: `${hTempF}°F`,
        weatherCode: hCode,
      });
    }
  });

  // Fallback timeline if hourly array was empty
  if (timeline.length === 0) {
    const defaultSlots = ['08:00 AM', '11:00 AM', '02:00 PM', '05:00 PM', '08:00 PM'];
    defaultSlots.forEach((slot, idx) => {
      timeline.push({
        time: slot,
        status: conditionInfo.condition,
        temp: `${tempF + (idx % 2 === 0 ? 2 : -2)}°F`,
        weatherCode: code,
      });
    });
  }

  // 7-day Extended Forecast
  const dailyDates: string[] = data.daily?.time || [];
  const dailyMax: number[] = data.daily?.temperature_2m_max || [];
  const dailyMin: number[] = data.daily?.temperature_2m_min || [];
  const dailyCodes: number[] = data.daily?.weather_code || [];

  const dailyForecast: DailyForecastItem[] = [];
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  dailyDates.slice(0, 7).forEach((dStr, idx) => {
    const d = new Date(dStr + 'T00:00:00');
    let dayLabel = daysOfWeek[d.getDay()];
    if (idx === 0) dayLabel = 'Today';
    if (idx === 1) dayLabel = 'Tomorrow';

    const maxC = dailyMax[idx] ?? tempC + 3;
    const minC = dailyMin[idx] ?? tempC - 4;
    const maxF = Math.round((maxC * 9 / 5) + 32);
    const minF = Math.round((minC * 9 / 5) + 32);
    const dCode = dailyCodes[idx] ?? code;
    const dCond = getWeatherConditionInfo(dCode).condition;

    dailyForecast.push({
      day: dayLabel,
      status: dCond,
      tempRange: `${minF}°F - ${maxF}°F`,
      weatherCode: dCode,
    });
  });

  return {
    city: cityName,
    currentTempF: tempF,
    currentTempC: tempC,
    condition: conditionInfo.condition,
    humidity,
    windSpeedMph: windMph,
    weatherCode: code,
    timeline,
    dailyForecast,
  };
}
