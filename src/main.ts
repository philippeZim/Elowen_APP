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

type AppState = {
  user: User | null;
  visibleMonth: Date;
  selectedDate: Date;
  error: string | null;
  syncError: string | null;
  reservations: Reservation[];
  bookingSlot: string | null;
  isSyncing: boolean;
  isTransitioning: boolean;
  screen: "calendar" | "settings";
  theme: "light" | "dark";
};

type DayStatus = "free" | "partial" | "full";

const app = document.querySelector<HTMLDivElement>("#app");
const state: AppState = {
  user: null,
  visibleMonth: new Date(),
  selectedDate: new Date(),
  error: null,
  syncError: null,
  reservations: [],
  bookingSlot: null,
  isSyncing: false,
  isTransitioning: false,
  screen: "calendar",
  theme: "light",
};

const weekdayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const timeSlots = [
  { startTime: "08:00", endTime: "12:00", label: "08:00 - 12:00" },
  { startTime: "12:00", endTime: "16:00", label: "12:00 - 16:00" },
  { startTime: "16:00", endTime: "20:00", label: "16:00 - 20:00" },
];
const localUserKey = "elowen.currentUser";
const themeKey = "elowen.theme";

function requireApp(): HTMLDivElement {
  if (!app) {
    throw new Error("App root element not found.");
  }

  return app;
}

function getStoredTheme(): "light" | "dark" {
  return localStorage.getItem(themeKey) === "dark" ? "dark" : "light";
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
  render();
}

function goToToday(): void {
  const today = new Date();
  state.visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  state.selectedDate = today;
  render();
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

async function loadReservations(): Promise<void> {
  state.isSyncing = true;
  render();

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

async function bookSlot(startTime: string, endTime: string): Promise<void> {
  if (!state.user) {
    return;
  }

  const reservationDate = toDateKey(state.selectedDate);
  const bookingSlot = `${reservationDate}:${startTime}:${endTime}`;
  state.bookingSlot = bookingSlot;
  state.syncError = null;
  render();

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
    state.syncError = error instanceof Error ? error.message : String(error);
    await loadReservations();
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
            <button class="button button-secondary" id="sync-button" type="button" ${state.isSyncing ? "disabled" : ""}>
              ${state.isSyncing ? "Lädt" : "Sync"}
            </button>
          </div>
          ${state.syncError ? `<p class="form-error sync-error">${escapeHtml(state.syncError)}</p>` : ""}
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

                return `
                  <div class="slot-row ${reservation ? "slot-booked" : ""}">
                    <div>
                      <strong>${slot.label}</strong>
                      <span>${reservation ? `Gebucht von ${escapeHtml(reservation.user_name)}` : "Verfügbar"}</span>
                    </div>
                    <button
                      class="button ${reservation ? "button-booked" : "button-secondary"}"
                      type="button"
                      data-start-time="${slot.startTime}"
                      data-end-time="${slot.endTime}"
                      ${reservation || isBooking ? "disabled" : ""}
                    >
                      ${isBooking ? "Bucht" : reservation ? "Belegt" : "Buchen"}
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
  document.querySelector("#sync-button")?.addEventListener("click", () => void loadReservations());
  document.querySelectorAll<HTMLButtonElement>("[data-start-time][data-end-time]").forEach((button) => {
    button.addEventListener("click", () => {
      const { startTime, endTime } = button.dataset;

      if (startTime && endTime) {
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
        </div>
      </section>
    </section>
  `;

  document.querySelector("#back-button")?.addEventListener("click", showCalendar);
  document.querySelector("#logout-button")?.addEventListener("click", () => void logout());
  document.querySelector("#theme-toggle")?.addEventListener("change", toggleTheme);
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
    await loadReservations();
  } catch (error) {
    state.isTransitioning = false;
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function init(): Promise<void> {
  state.theme = getStoredTheme();
  applyTheme();
  state.user = await getPersistedUser();
  render();

  if (state.user) {
    await loadReservations();
  }
}

window.addEventListener("DOMContentLoaded", () => void init());
