import { invoke } from "@tauri-apps/api/core";

type User = {
  id: number;
  name: string;
};

type Reservation = {
  reservation_date: string;
  start_time: string;
  end_time: string;
  user_name: string;
  created_at: string;
};

type BookSlotResponse = {
  reservations: Reservation[];
};

type SlotActionResponse = {
  reservations: Reservation[];
};

type WeatherApiResponse = {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    weather_code?: number[];
  };
};

type WeatherLocation = {
  name: string;
  latitude: number;
  longitude: number;
};

type WeatherHour = {
  time: string;
  temperature: number;
  code: number;
};

type DailyWeather = {
  slots: Record<string, SlotWeather>;
  cachedAt: number;
};

type SlotWeather = {
  temperature: number;
  code: number;
};

type TokenStatus = {
  configured: boolean;
};

type AppState = {
  user: User | null;
  visibleMonth: Date;
  selectedDate: Date;
  error: string | null;
  syncError: string | null;
  syncIntervalMinutes: number;
  syncIntervalMessage: string | null;
  tokenConfigured: boolean;
  tokenMessage: string | null;
  reservations: Reservation[];
  weatherLocation: WeatherLocation;
  weatherLocationMessage: string | null;
  weatherByDate: Record<string, DailyWeather>;
  weatherError: string | null;
  weatherLoadingDate: string | null;
  bookingSlot: string | null;
  isSyncing: boolean;
  isSavingToken: boolean;
  isSavingWeatherLocation: boolean;
  isWeatherLocationMenuOpen: boolean;
  isTransitioning: boolean;
  screen: "calendar" | "settings";
  theme: "light" | "dark";
};

type DayStatus = "free" | "partial" | "full";

const app = document.querySelector<HTMLDivElement>("#app");
const weekdayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const timeSlots = [
  { startTime: "08:00", endTime: "12:00", label: "08:00 - 12:00" },
  { startTime: "12:00", endTime: "16:00", label: "12:00 - 16:00" },
  { startTime: "16:00", endTime: "20:00", label: "16:00 - 20:00" },
];
const localUserKey = "elowen.currentUser";
const themeKey = "elowen.theme";
const syncIntervalKey = "elowen.syncIntervalMinutes";
const weatherLocationKey = "elowen.weatherLocation";
const weatherCacheKeyPrefix = "elowen.weatherCache";
const weatherCacheDurationMs = 20 * 60 * 1000;
const defaultSyncIntervalMinutes = 2;
const minSyncIntervalMinutes = 1;
const maxSyncIntervalMinutes = 60;
const defaultWeatherLocation: WeatherLocation = {
  name: "Überlingen",
  latitude: 47.7698,
  longitude: 9.1714,
};
const bodenseeWeatherLocations: WeatherLocation[] = [
  { name: "Konstanz", latitude: 47.66033, longitude: 9.17582 },
  { name: "Kreuzlingen", latitude: 47.65051, longitude: 9.17504 },
  { name: "Meersburg", latitude: 47.69419, longitude: 9.27113 },
  { name: "Friedrichshafen", latitude: 47.65689, longitude: 9.47554 },
  { name: "Lindau", latitude: 47.54612, longitude: 9.68431 },
  { name: "Bregenz", latitude: 47.50311, longitude: 9.7471 },
  { name: "Überlingen", latitude: 47.76977, longitude: 9.17136 },
  { name: "Radolfzell am Bodensee", latitude: 47.74194, longitude: 8.97098 },
  { name: "Romanshorn", latitude: 47.56586, longitude: 9.37869 },
  { name: "Rorschach", latitude: 47.478, longitude: 9.4903 },
  { name: "Arbon", latitude: 47.51667, longitude: 9.43333 },
  { name: "Stein am Rhein", latitude: 47.65933, longitude: 8.85964 },
  { name: "Allensbach", latitude: 47.71536, longitude: 9.07145 },
  { name: "Reichenau", latitude: 47.68885, longitude: 9.06355 },
  { name: "Bodman-Ludwigshafen", latitude: 47.81817, longitude: 9.0554 },
  { name: "Sipplingen", latitude: 47.79678, longitude: 9.09737 },
  { name: "Uhldingen-Mühlhofen", latitude: 47.73333, longitude: 9.25 },
  { name: "Hagnau", latitude: 47.67666, longitude: 9.31787 },
  { name: "Immenstaad am Bodensee", latitude: 47.66667, longitude: 9.36667 },
  { name: "Langenargen", latitude: 47.59858, longitude: 9.54163 },
  { name: "Kressbronn am Bodensee", latitude: 47.5976, longitude: 9.59707 },
  { name: "Nonnenhorn", latitude: 47.57386, longitude: 9.61038 },
  { name: "Wasserburg (Bodensee)", latitude: 47.57223, longitude: 9.63215 },
  { name: "Hard", latitude: 47.48306, longitude: 9.68306 },
  { name: "Lochau am Bodensee", latitude: 47.53333, longitude: 9.75 },
  { name: "Hörbranz", latitude: 47.55, longitude: 9.75 },
  { name: "Ermatingen", latitude: 47.67057, longitude: 9.08573 },
  { name: "Gottlieben", latitude: 47.6638, longitude: 9.13371 },
  { name: "Steckborn", latitude: 47.66667, longitude: 8.98333 },
  { name: "Mammern", latitude: 47.64625, longitude: 8.91519 },
];

const state: AppState = {
  user: null,
  visibleMonth: new Date(),
  selectedDate: new Date(),
  error: null,
  syncError: null,
  syncIntervalMinutes: defaultSyncIntervalMinutes,
  syncIntervalMessage: null,
  tokenConfigured: false,
  tokenMessage: null,
  reservations: [],
  weatherLocation: defaultWeatherLocation,
  weatherLocationMessage: null,
  weatherByDate: {},
  weatherError: null,
  weatherLoadingDate: null,
  bookingSlot: null,
  isSyncing: false,
  isSavingToken: false,
  isSavingWeatherLocation: false,
  isWeatherLocationMenuOpen: false,
  isTransitioning: false,
  screen: "calendar",
  theme: "light",
};

let syncTimerId: number | null = null;

function requireApp(): HTMLDivElement {
  if (!app) {
    throw new Error("App root element not found.");
  }

  return app;
}

function getStoredTheme(): "light" | "dark" {
  return localStorage.getItem(themeKey) === "dark" ? "dark" : "light";
}

function normalizeSyncIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    return defaultSyncIntervalMinutes;
  }

  return Math.min(maxSyncIntervalMinutes, Math.max(minSyncIntervalMinutes, Math.round(value)));
}

function getStoredSyncIntervalMinutes(): number {
  const storedValue = localStorage.getItem(syncIntervalKey);

  if (!storedValue) {
    return defaultSyncIntervalMinutes;
  }

  const parsedValue = Number(storedValue);

  if (!Number.isFinite(parsedValue)) {
    localStorage.removeItem(syncIntervalKey);
    return defaultSyncIntervalMinutes;
  }

  return normalizeSyncIntervalMinutes(parsedValue);
}

function saveSyncIntervalMinutes(value: number): void {
  localStorage.setItem(syncIntervalKey, String(normalizeSyncIntervalMinutes(value)));
}

function getStoredWeatherLocation(): WeatherLocation {
  const storedLocation = localStorage.getItem(weatherLocationKey);

  if (!storedLocation) {
    return defaultWeatherLocation;
  }

  try {
    const location = JSON.parse(storedLocation) as WeatherLocation;

    if (
      location &&
      typeof location.name === "string" &&
      typeof location.latitude === "number" &&
      typeof location.longitude === "number"
    ) {
      return findBodenseeWeatherLocation(location.name) ?? defaultWeatherLocation;
    }
  } catch {
    localStorage.removeItem(weatherLocationKey);
  }

  return defaultWeatherLocation;
}

function findBodenseeWeatherLocation(name: string): WeatherLocation | null {
  return bodenseeWeatherLocations.find((location) => location.name === name) ?? null;
}

function saveWeatherLocation(location: WeatherLocation): void {
  localStorage.setItem(weatherLocationKey, JSON.stringify(location));
}

function getWeatherCacheKey(location = state.weatherLocation): string {
  return `${weatherCacheKeyPrefix}:${location.latitude.toFixed(4)}:${location.longitude.toFixed(4)}`;
}

function clearCurrentWeatherCache(): void {
  state.weatherByDate = {};
  localStorage.removeItem(getWeatherCacheKey());
}

function applyTheme(): void {
  document.documentElement.dataset.theme = state.theme;
}

function sameDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function toDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function escapeHtml(value: string): string {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function isCommandMissingError(error: unknown): boolean {
  return String(error).toLowerCase().includes("command") && String(error).includes("not found");
}

function getLocalUser(): User | null {
  const storedUser = localStorage.getItem(localUserKey);

  if (!storedUser) {
    return null;
  }

  try {
    return JSON.parse(storedUser) as User;
  } catch {
    localStorage.removeItem(localUserKey);
    return null;
  }
}

function getStoredWeatherCache(): Record<string, DailyWeather> {
  const storedCache = localStorage.getItem(getWeatherCacheKey());

  if (!storedCache) {
    return {};
  }

  try {
    const parsedCache = JSON.parse(storedCache) as Record<string, DailyWeather>;
    const now = Date.now();

    return Object.fromEntries(
      Object.entries(parsedCache).filter(([, weather]) => {
        return (
          weather &&
          typeof weather.cachedAt === "number" &&
          now - weather.cachedAt < weatherCacheDurationMs
        );
      }),
    );
  } catch {
    localStorage.removeItem(getWeatherCacheKey());
    return {};
  }
}

function saveWeatherCache(): void {
  const now = Date.now();
  const freshCache = Object.fromEntries(
    Object.entries(state.weatherByDate).filter(([, weather]) => {
      return now - weather.cachedAt < weatherCacheDurationMs;
    }),
  );

  localStorage.setItem(getWeatherCacheKey(), JSON.stringify(freshCache));
}

async function getPersistedUser(): Promise<User | null> {
  try {
    return await invoke<User | null>("get_current_user");
  } catch (error) {
    if (isCommandMissingError(error)) {
      return getLocalUser();
    }

    console.error(error);
    return null;
  }
}

async function persistUser(name: string): Promise<User> {
  try {
    const user = await invoke<User>("register_user", { name });
    localStorage.setItem(localUserKey, JSON.stringify(user));
    return user;
  } catch (error) {
    if (isCommandMissingError(error)) {
      const user = { id: Date.now(), name };
      localStorage.setItem(localUserKey, JSON.stringify(user));
      return user;
    }

    console.error(error);
    throw new Error("Registrierung nicht möglich.");
  }
}

async function loadTokenStatus(): Promise<void> {
  try {
    const status = await invoke<TokenStatus>("get_github_token_status");
    state.tokenConfigured = status.configured;
  } catch (error) {
    console.error(error);
    state.tokenConfigured = false;
  }
}

async function saveGithubToken(token: string): Promise<void> {
  state.isSavingToken = true;
  state.tokenMessage = null;
  render();

  try {
    const status = await invoke<TokenStatus>("save_github_token", { token });
    state.tokenConfigured = status.configured;
    state.tokenMessage = "Token gespeichert.";
    state.syncError = null;
    await loadReservations();
  } catch (error) {
    state.tokenMessage = error instanceof Error ? error.message : String(error);
  } finally {
    state.isSavingToken = false;
    render();
  }
}

function formatWeatherLocation(location: WeatherLocation): string {
  return location.name;
}

function toggleWeatherLocationMenu(): void {
  if (state.isSavingWeatherLocation) {
    return;
  }

  state.isWeatherLocationMenuOpen = !state.isWeatherLocationMenuOpen;
  render();
}

function selectWeatherLocationOption(locationName: string): void {
  const location = findBodenseeWeatherLocation(locationName);

  if (!location || state.isSavingWeatherLocation) {
    return;
  }

  state.weatherLocation = location;
  state.weatherLocationMessage = null;
  state.isWeatherLocationMenuOpen = false;
  render();
}

async function saveWeatherLocationFromSelection(locationName: string): Promise<void> {
  state.isSavingWeatherLocation = true;
  state.isWeatherLocationMenuOpen = false;
  state.weatherLocationMessage = null;
  render();

  try {
    const location = findBodenseeWeatherLocation(locationName);

    if (!location) {
      throw new Error("Bitte einen Bodensee-Ort auswählen.");
    }

    state.weatherLocation = location;
    state.weatherError = null;
    state.weatherLoadingDate = null;
    saveWeatherLocation(location);
    clearCurrentWeatherCache();
    state.weatherLocationMessage = "Ort gespeichert.";
    await loadWeatherForDate(toDateKey(state.selectedDate));
  } catch (error) {
    state.weatherLocationMessage = error instanceof Error ? error.message : String(error);
  } finally {
    state.isSavingWeatherLocation = false;
    render();
  }
}

function getCalendarDates(month: Date): Date[] {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const calendarStart = new Date(firstDay);
  calendarStart.setDate(firstDay.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    return date;
  });
}

function formatMonth(date: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatSelectedDate(date: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function getDayStatus(dateKey: string): DayStatus {
  const reservationCount = state.reservations.filter(
    (reservation) => reservation.reservation_date === dateKey,
  ).length;

  if (reservationCount >= timeSlots.length) {
    return "full";
  }

  if (reservationCount > 0) {
    return "partial";
  }

  return "free";
}

function setVisibleMonth(monthDelta: number): void {
  state.visibleMonth = new Date(
    state.visibleMonth.getFullYear(),
    state.visibleMonth.getMonth() + monthDelta,
    1,
  );
  render();
}

function selectDate(dateKey: string): void {
  state.selectedDate = new Date(`${dateKey}T12:00:00`);
  state.weatherError = null;
  render();
  void loadWeatherForDate(dateKey);
}

function goToToday(): void {
  const today = new Date();
  state.visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  state.selectedDate = today;
  state.weatherError = null;
  render();
  void loadWeatherForDate(toDateKey(today));
}

function getReservationForSlot(
  reservationDate: string,
  startTime: string,
  endTime: string,
): Reservation | undefined {
  return state.reservations.find(
    (reservation) =>
      reservation.reservation_date === reservationDate &&
      reservation.start_time === startTime &&
      reservation.end_time === endTime,
  );
}

function getWeatherDescription(code: number): string {
  if (code === 0) {
    return "Sonnig";
  }

  if (code === 1) {
    return "Meist sonnig";
  }

  if (code === 2) {
    return "Teils bewölkt";
  }

  if (code === 3) {
    return "Bewölkt";
  }

  if (code === 45 || code === 48) {
    return "Nebel";
  }

  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return "Regen";
  }

  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    return "Schnee";
  }

  if (code >= 95) {
    return "Gewitter";
  }

  return "Wetter";
}

function getWeatherEmoji(code: number): string {
  if (code === 0) {
    return "☀️";
  }

  if (code === 1) {
    return "🌤️";
  }

  if (code === 2) {
    return "⛅";
  }

  if (code === 3) {
    return "☁️";
  }

  if (code === 45 || code === 48) {
    return "🌫️";
  }

  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return "🌧️";
  }

  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    return "❄️";
  }

  if (code >= 95) {
    return "⛈️";
  }

  return "🌡️";
}

function getSlotWeatherKey(startTime: string, endTime: string): string {
  return `${startTime}-${endTime}`;
}

function parseHour(time: string): number {
  return Number(time.slice(11, 13));
}

function getRepresentativeWeatherCode(hours: WeatherHour[]): number {
  const priority = [95, 96, 99, 82, 81, 80, 67, 66, 65, 63, 61, 57, 56, 55, 53, 51, 86, 85, 77, 75, 73, 71, 48, 45, 3, 2, 1, 0];

  return priority.find((code) => hours.some((hour) => hour.code === code)) ?? hours[0]?.code ?? 0;
}

function buildDailyWeather(weatherHours: WeatherHour[]): DailyWeather {
  const slots = timeSlots.reduce<Record<string, SlotWeather>>((accumulator, slot) => {
    const startHour = Number(slot.startTime.slice(0, 2));
    const endHour = Number(slot.endTime.slice(0, 2));
    const slotHours = weatherHours.filter((hour) => {
      const hourValue = parseHour(hour.time);
      return hourValue >= startHour && hourValue < endHour;
    });

    if (slotHours.length > 0) {
      const averageTemperature =
        slotHours.reduce((sum, hour) => sum + hour.temperature, 0) / slotHours.length;
      accumulator[getSlotWeatherKey(slot.startTime, slot.endTime)] = {
        temperature: Math.round(averageTemperature),
        code: getRepresentativeWeatherCode(slotHours),
      };
    }

    return accumulator;
  }, {});

  return { slots, cachedAt: Date.now() };
}

async function loadWeatherForDate(dateKey: string): Promise<void> {
  const location = state.weatherLocation;
  const weatherCacheKey = getWeatherCacheKey(location);
  const cachedWeather = state.weatherByDate[dateKey];

  if (cachedWeather && Date.now() - cachedWeather.cachedAt < weatherCacheDurationMs) {
    return;
  }

  if (cachedWeather) {
    delete state.weatherByDate[dateKey];
    saveWeatherCache();
  }

  if (state.weatherLoadingDate === dateKey) {
    return;
  }

  state.weatherLoadingDate = dateKey;
  state.weatherError = null;
  render();

  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    hourly: "temperature_2m,weather_code",
    timezone: "Europe/Berlin",
    start_date: dateKey,
    end_date: dateKey,
    models: "icon_seamless",
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);

    if (!response.ok) {
      throw new Error("Wetterdaten nicht verfügbar.");
    }

    const data = (await response.json()) as WeatherApiResponse;
    const times = data.hourly?.time ?? [];
    const temperatures = data.hourly?.temperature_2m ?? [];
    const codes = data.hourly?.weather_code ?? [];
    const weatherHours = times
      .map<WeatherHour | null>((time, index) => {
        const temperature = temperatures[index];
        const code = codes[index];

        if (typeof temperature !== "number" || typeof code !== "number") {
          return null;
        }

        return { time, temperature, code };
      })
      .filter((hour): hour is WeatherHour => hour !== null);

    if (getWeatherCacheKey() !== weatherCacheKey) {
      return;
    }

    state.weatherByDate[dateKey] = buildDailyWeather(weatherHours);
    saveWeatherCache();
  } catch (error) {
    if (getWeatherCacheKey() !== weatherCacheKey) {
      return;
    }

    console.error(error);
    state.weatherError = "Wettervorhersage konnte nicht geladen werden.";
  } finally {
    if (getWeatherCacheKey() === weatherCacheKey) {
      state.weatherLoadingDate = null;
    }
    render();
  }
}

async function loadReservations(): Promise<void> {
  return syncReservations();
}

async function syncReservations({ background = false }: { background?: boolean } = {}): Promise<void> {
  if (state.isSyncing) {
    return;
  }

  state.isSyncing = true;

  if (!background) {
    render();
  }

  try {
    state.reservations = await invoke<Reservation[]>("list_reservations");
    state.syncError = null;
  } catch (error) {
    state.syncError = error instanceof Error ? error.message : String(error);
  } finally {
    state.isSyncing = false;
    render();
  }
}

function stopAutoSync(): void {
  if (syncTimerId !== null) {
    window.clearInterval(syncTimerId);
    syncTimerId = null;
  }
}

function startAutoSync(): void {
  stopAutoSync();

  if (!state.user) {
    return;
  }

  syncTimerId = window.setInterval(() => {
    void syncReservations({ background: true });
  }, state.syncIntervalMinutes * 60 * 1000);
}

async function bookSlot(startTime: string, endTime: string): Promise<void> {
  if (!state.user) {
    return;
  }

  const reservationDate = toDateKey(state.selectedDate);
  const bookingSlot = `${reservationDate}:${startTime}:${endTime}`;
  state.bookingSlot = bookingSlot;
  state.syncError = null;
  render();
  await waitForPaint();

  try {
    const response = await invoke<BookSlotResponse>("book_time_slot", {
      reservationDate,
      startTime,
      endTime,
      userName: state.user.name,
    });
    state.reservations = response.reservations;
    state.syncError = null;
  } catch (error) {
    const bookingError = error instanceof Error ? error.message : String(error);
    await loadReservations();
    state.syncError = bookingError;
  } finally {
    state.bookingSlot = null;
    render();
  }
}

async function releaseSlot(startTime: string, endTime: string): Promise<void> {
  if (!state.user) {
    return;
  }

  const reservationDate = toDateKey(state.selectedDate);
  const bookingSlot = `${reservationDate}:${startTime}:${endTime}`;
  state.bookingSlot = bookingSlot;
  state.syncError = null;
  render();
  await waitForPaint();

  try {
    const response = await invoke<SlotActionResponse>("release_time_slot", {
      reservationDate,
      startTime,
      endTime,
      userName: state.user.name,
    });
    state.reservations = response.reservations;
    state.syncError = null;
  } catch (error) {
    const releaseError = error instanceof Error ? error.message : String(error);
    await loadReservations();
    state.syncError = releaseError;
  } finally {
    state.bookingSlot = null;
    render();
  }
}

function showSettings(): void {
  state.screen = "settings";
  render();
}

function showCalendar(): void {
  state.screen = "calendar";
  render();
}

function toggleTheme(): void {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem(themeKey, state.theme);
  applyTheme();
  render();
}

async function logout(): Promise<void> {
  stopAutoSync();

  try {
    await invoke("logout_user");
  } catch (error) {
    if (!isCommandMissingError(error)) {
      console.error(error);
    }
  }

  localStorage.removeItem(localUserKey);
  state.user = null;
  state.error = null;
  state.isTransitioning = false;
  state.screen = "calendar";
  render();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function renderRegisterScreen(): void {
  requireApp().innerHTML = `
    <section class="auth-shell">
      <div class="auth-card">
        <div class="stack">
          <p class="eyebrow">Bootsmanager</p>
          <h1>Elowen</h1>
        </div>
        <form id="register-form" class="form-stack">
          <label class="field">
            <span>Name</span>
            <input id="name-input" name="name" type="text" autocomplete="name" placeholder="Dein Name" />
          </label>
          <button class="button button-primary" type="submit" ${state.isTransitioning ? "disabled" : ""}>Weiter</button>
          ${state.error ? `<p class="form-error">${escapeHtml(state.error)}</p>` : ""}
        </form>
      </div>
    </section>
  `;

  document
    .querySelector<HTMLFormElement>("#register-form")
    ?.addEventListener("submit", handleRegister);
  document.querySelector<HTMLInputElement>("#name-input")?.focus();
}

function renderCalendarScreen(): void {
  const calendarDates = getCalendarDates(state.visibleMonth);
  const currentMonth = state.visibleMonth.getMonth();
  const selectedKey = toDateKey(state.selectedDate);
  const selectedDayStatus = getDayStatus(selectedKey);
  const selectedWeather = state.weatherByDate[selectedKey];
  const isWeatherLoading = state.weatherLoadingDate === selectedKey;
  const today = new Date();

  requireApp().innerHTML = `
    <section class="app-shell">
      <header class="topbar">
        <div>
          <h1>Elowen</h1>
        </div>
        <button class="icon-button settings-button" id="settings-button" type="button" aria-label="Einstellungen">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"></path>
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.38a1.7 1.7 0 0 0-1 .62 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 8 19.38a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.62 15a1.7 1.7 0 0 0-.62-1 1.7 1.7 0 0 0-1.1-.4H1.8a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 3.62 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8 3.62a1.7 1.7 0 0 0 1-.62A1.7 1.7 0 0 0 9.4 1.9V1.8a2 2 0 0 1 4 0v.09A1.7 1.7 0 0 0 15 3.62a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.38 8a1.7 1.7 0 0 0 .62 1 1.7 1.7 0 0 0 1.1.4h.1a2 2 0 0 1 0 4h-.1A1.7 1.7 0 0 0 19.4 15Z"></path>
          </svg>
        </button>
      </header>

      <section class="calendar-layout">
        <div class="panel calendar-panel">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Kalender</p>
              <h2>${formatMonth(state.visibleMonth)}</h2>
            </div>
            <div class="button-group" aria-label="Monat wechseln">
              <button class="button button-secondary today-button" id="today-button" type="button">Heute</button>
              <button class="icon-button" id="prev-month" type="button" aria-label="Vorheriger Monat">&lt;</button>
              <button class="icon-button" id="next-month" type="button" aria-label="Nächster Monat">&gt;</button>
            </div>
          </div>
          <div class="weekday-grid">
            ${weekdayLabels.map((day) => `<span>${day}</span>`).join("")}
          </div>
          <div class="date-grid">
            ${calendarDates
              .map((date) => {
                const dateKey = toDateKey(date);
                const status = getDayStatus(dateKey);
                const classes = [
                  "date-cell",
                  `date-${status}`,
                  date.getMonth() !== currentMonth ? "date-muted" : "",
                  sameDate(date, today) ? "date-today" : "",
                  dateKey === selectedKey ? "date-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return `
                  <button class="${classes}" type="button" data-date="${dateKey}">
                    <span class="date-number">${date.getDate()}</span>
                  </button>
                `;
              })
              .join("")}
          </div>
        </div>

        <aside class="panel agenda-panel">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Ausgewählter Tag</p>
              <h2>${formatSelectedDate(state.selectedDate)}</h2>
            </div>
          </div>
          ${state.syncError ? `<p class="form-error sync-error">${escapeHtml(state.syncError)}</p>` : ""}
          <div class="status-row" aria-live="polite">
            <span>${state.isSyncing ? "Kalender wird aktualisiert." : `Automatischer Sync alle ${state.syncIntervalMinutes} Min.`}</span>
          </div>
          <div class="weather-summary" aria-live="polite">
            <span>${isWeatherLoading ? `Wetter lädt: ${formatWeatherLocation(state.weatherLocation)}` : selectedWeather ? `Wettervorhersage: ${formatWeatherLocation(state.weatherLocation)}` : state.weatherError ? escapeHtml(state.weatherError) : `Wettervorhersage: ${formatWeatherLocation(state.weatherLocation)}`}</span>
          </div>
          <div class="slot-list">
            ${timeSlots
              .map((slot) => {
                const reservation = getReservationForSlot(
                  selectedKey,
                  slot.startTime,
                  slot.endTime,
                );
                const bookingKey = `${selectedKey}:${slot.startTime}:${slot.endTime}`;
                const isBooking = state.bookingSlot === bookingKey;
                const isOwnReservation = reservation?.user_name === state.user?.name;
                const action = reservation ? "release" : "book";
                const slotWeather =
                  selectedWeather?.slots[getSlotWeatherKey(slot.startTime, slot.endTime)];
                const slotStatusClass = reservation
                  ? selectedDayStatus === "full"
                    ? "slot-full"
                    : "slot-booked"
                  : "slot-free";
                const buttonText = isBooking
                  ? isOwnReservation
                    ? "Gibt frei"
                    : "Bucht"
                  : reservation
                    ? isOwnReservation
                      ? "Freigeben"
                      : "Belegt"
                    : "Buchen";

                return `
                  <div class="slot-row ${slotStatusClass}">
                    <div class="slot-main">
                      <strong>${slot.label}</strong>
                      <span>${reservation ? `Gebucht von ${escapeHtml(reservation.user_name)}` : "Verfügbar"}</span>
                    </div>
                    <span class="slot-weather" title="${slotWeather ? getWeatherDescription(slotWeather.code) : ""}">
                      ${
                        slotWeather
                          ? `<span class="slot-weather-icon" aria-hidden="true">${getWeatherEmoji(slotWeather.code)}</span><span>${slotWeather.temperature} °C</span>`
                          : isWeatherLoading
                            ? "Wetter lädt"
                            : "Kein Wetter verfügbar"
                      }
                    </span>
                    <button
                      class="button ${reservation ? (isOwnReservation ? "button-secondary" : "button-booked") : "button-secondary"} ${isBooking ? "is-loading" : ""}"
                      type="button"
                      data-slot-action="${action}"
                      data-start-time="${slot.startTime}"
                      data-end-time="${slot.endTime}"
                      ${isBooking || (reservation && !isOwnReservation) ? "disabled" : ""}
                    >
                      ${isBooking ? `<span class="button-spinner" aria-hidden="true"><span></span></span>` : ""}
                      ${buttonText}
                    </button>
                  </div>
                `;
              })
              .join("")}
          </div>
        </aside>
      </section>
    </section>
  `;

  document.querySelector("#prev-month")?.addEventListener("click", () => {
    setVisibleMonth(-1);
  });
  document.querySelector("#next-month")?.addEventListener("click", () => {
    setVisibleMonth(1);
  });
  document.querySelector("#today-button")?.addEventListener("click", goToToday);
  document.querySelector("#settings-button")?.addEventListener("click", showSettings);
  document.querySelectorAll<HTMLButtonElement>("[data-slot-action][data-start-time][data-end-time]").forEach((button) => {
    button.addEventListener("click", () => {
      const { slotAction, startTime, endTime } = button.dataset;

      if (startTime && endTime) {
        if (slotAction === "release") {
          void releaseSlot(startTime, endTime);
          return;
        }

        void bookSlot(startTime, endTime);
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-date]").forEach((button) => {
    button.addEventListener("click", () => {
      const dateKey = button.dataset.date;

      if (dateKey) {
        selectDate(dateKey);
      }
    });
  });
}

function renderSettingsScreen(): void {
  requireApp().innerHTML = `
    <section class="app-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Einstellungen</p>
          <h1>Elowen</h1>
        </div>
        <button class="button button-secondary" id="back-button" type="button">Zurück</button>
      </header>

      <section class="settings-layout">
        <div class="panel settings-panel">
          <div class="settings-row">
            <div>
              <p class="eyebrow">Profil</p>
              <h2>${escapeHtml(state.user?.name ?? "")}</h2>
            </div>
            <button class="button button-secondary logout-button" id="logout-button" type="button">Abmelden</button>
          </div>

          <div class="settings-row">
            <div>
              <p class="eyebrow">Darstellung</p>
              <h2>${state.theme === "dark" ? "Dunkel" : "Hell"}</h2>
            </div>
            <label class="theme-switch">
              <input id="theme-toggle" type="checkbox" ${state.theme === "dark" ? "checked" : ""} />
              <span></span>
            </label>
          </div>

          <form id="sync-interval-form" class="settings-row settings-sync-row">
            <div>
              <p class="eyebrow">Kalender-Sync</p>
              <h2>Alle ${state.syncIntervalMinutes} Min.</h2>
              <p class="settings-message">Der Abgleich laeuft automatisch im Hintergrund.</p>
              ${state.syncIntervalMessage ? `<p class="settings-message">${escapeHtml(state.syncIntervalMessage)}</p>` : ""}
            </div>
            <div class="settings-controls settings-inline-controls">
              <label class="settings-number-field" for="sync-interval-input">
                <span>Minuten</span>
                <input
                  id="sync-interval-input"
                  name="syncIntervalMinutes"
                  type="number"
                  inputmode="numeric"
                  min="${minSyncIntervalMinutes}"
                  max="${maxSyncIntervalMinutes}"
                  step="1"
                  value="${state.syncIntervalMinutes}"
                />
              </label>
              <button class="button button-secondary" type="submit">Speichern</button>
            </div>
          </form>

          <form id="weather-location-form" class="settings-row settings-location-row">
            <div>
              <p class="eyebrow">Wettervorhersage</p>
              <h2>${escapeHtml(formatWeatherLocation(state.weatherLocation))}</h2>
              ${state.weatherLocationMessage ? `<p class="settings-message">${escapeHtml(state.weatherLocationMessage)}</p>` : ""}
            </div>
            <div class="settings-controls">
              <div class="settings-select ${state.isWeatherLocationMenuOpen ? "is-open" : ""}">
                <button
                  class="settings-select-trigger"
                  id="weather-location-trigger"
                  type="button"
                  aria-expanded="${state.isWeatherLocationMenuOpen ? "true" : "false"}"
                  aria-haspopup="listbox"
                  ${state.isSavingWeatherLocation ? "disabled" : ""}
                >
                  <span>${escapeHtml(formatWeatherLocation(state.weatherLocation))}</span>
                  <span class="settings-select-chevron" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                </button>
                ${
                  state.isWeatherLocationMenuOpen
                    ? `
                      <div class="settings-select-popover">
                        <div class="settings-select-list" id="weather-location-list" role="listbox" aria-label="Bodensee-Orte">
                          ${bodenseeWeatherLocations
                            .map((location) => {
                              const locationName = formatWeatherLocation(location);
                              const isSelected = locationName === state.weatherLocation.name;
                              return `
                                <button
                                  class="settings-select-option ${isSelected ? "is-selected" : ""}"
                                  type="button"
                                  role="option"
                                  aria-selected="${isSelected ? "true" : "false"}"
                                  data-weather-location-option="${escapeAttribute(locationName)}"
                                >
                                  <span>${escapeHtml(locationName)}</span>
                                  <span class="settings-select-check" aria-hidden="true">
                                    ${
                                      isSelected
                                        ? `<svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7" /></svg>`
                                        : ""
                                    }
                                  </span>
                                </button>
                              `;
                            })
                            .join("")}
                        </div>
                      </div>
                    `
                    : ""
                }
              </div>
              <button class="button button-secondary" type="submit" ${state.isSavingWeatherLocation ? "disabled" : ""}>
                ${state.isSavingWeatherLocation ? "Speichert" : "Speichern"}
              </button>
            </div>
          </form>

          <form id="github-token-form" class="settings-row settings-token-row">
            <div>
              <p class="eyebrow">GitHub Token</p>
              <h2>${state.tokenConfigured ? "Gespeichert" : "Nicht gespeichert"}</h2>
              ${state.tokenMessage ? `<p class="settings-message">${escapeHtml(state.tokenMessage)}</p>` : ""}
            </div>
            <div class="settings-controls">
              <input
                id="github-token-input"
                name="token"
                type="password"
                autocomplete="off"
                placeholder="Token einfügen"
                ${state.isSavingToken ? "disabled" : ""}
              />
              <button class="button button-secondary" type="submit" ${state.isSavingToken ? "disabled" : ""}>
                ${state.isSavingToken ? "Speichert" : "Speichern"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </section>
  `;

  document.querySelector("#back-button")?.addEventListener("click", showCalendar);
  document.querySelector("#logout-button")?.addEventListener("click", () => void logout());
  document.querySelector("#theme-toggle")?.addEventListener("change", toggleTheme);
  document
    .querySelector<HTMLFormElement>("#sync-interval-form")
    ?.addEventListener("submit", handleSyncIntervalSubmit);
  document.querySelector("#weather-location-trigger")?.addEventListener("click", toggleWeatherLocationMenu);
  document.querySelectorAll<HTMLButtonElement>("[data-weather-location-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const locationName = button.dataset.weatherLocationOption;

      if (locationName) {
        selectWeatherLocationOption(locationName);
      }
    });
  });
  document
    .querySelector<HTMLFormElement>("#weather-location-form")
    ?.addEventListener("submit", handleWeatherLocationSubmit);
  document
    .querySelector<HTMLFormElement>("#github-token-form")
    ?.addEventListener("submit", handleTokenSubmit);
}

function render(): void {
  if (state.user) {
    if (state.screen === "settings") {
      renderSettingsScreen();
      return;
    }

    renderCalendarScreen();
    return;
  }

  renderRegisterScreen();
}

async function handleRegister(event: SubmitEvent): Promise<void> {
  event.preventDefault();

  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const formData = new FormData(form);
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    state.error = "Bitte Namen eingeben.";
    render();
    return;
  }

  try {
    const user = await persistUser(name);
    state.error = null;
    state.isTransitioning = true;

    document.querySelector(".auth-shell")?.classList.add("auth-leaving");
    await wait(760);

    state.user = user;
    state.isTransitioning = false;
    render();
    startAutoSync();
    await Promise.all([loadReservations(), loadWeatherForDate(toDateKey(state.selectedDate))]);
  } catch (error) {
    state.isTransitioning = false;
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function handleTokenSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();

  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const formData = new FormData(form);
  const token = String(formData.get("token") ?? "").trim();

  if (!token) {
    state.tokenMessage = "Bitte Token einfügen.";
    render();
    return;
  }

  await saveGithubToken(token);
}

async function handleWeatherLocationSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();

  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const formData = new FormData(form);
  const location = String(formData.get("location") ?? "").trim();

  if (!location) {
    state.weatherLocationMessage = "Bitte einen Bodensee-Ort auswählen.";
    render();
    return;
  }

  await saveWeatherLocationFromSelection(location);
}

async function handleSyncIntervalSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();

  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const formData = new FormData(form);
  const rawValue = String(formData.get("syncIntervalMinutes") ?? "").trim();
  const nextValue = Number(rawValue);

  if (!rawValue || !Number.isFinite(nextValue)) {
    state.syncIntervalMessage = "Bitte eine gueltige Anzahl Minuten eingeben.";
    render();
    return;
  }

  const normalizedValue = normalizeSyncIntervalMinutes(nextValue);
  saveSyncIntervalMinutes(normalizedValue);
  state.syncIntervalMinutes = normalizedValue;
  state.syncIntervalMessage = `Automatischer Sync gespeichert: alle ${normalizedValue} Min.`;
  startAutoSync();
  render();
}

async function init(): Promise<void> {
  state.theme = getStoredTheme();
  state.syncIntervalMinutes = getStoredSyncIntervalMinutes();
  state.weatherLocation = getStoredWeatherLocation();
  state.weatherByDate = getStoredWeatherCache();
  applyTheme();
  state.user = await getPersistedUser();
  await loadTokenStatus();
  render();

  if (state.user) {
    startAutoSync();
    await Promise.all([loadReservations(), loadWeatherForDate(toDateKey(state.selectedDate))]);
  }
}

window.addEventListener("DOMContentLoaded", () => void init());
