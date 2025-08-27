// src/pages/CalendarPage.jsx
import { useEffect, useState } from "react";
import { gapi } from "gapi-script";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import Event from "../Components/Event.js";
import "../style/CalendarPage.css";

export default function CalendarPage() {
  const [events, setEvents] = useState([]);
  const [calendarId, setCalendarID] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGapiLoaded, setIsGapiLoaded] = useState(false);
  const [isGoogleSignedIn, setIsGoogleSignedIn] = useState(false);

  const today = new Date();
  const [date, setDate] = useState(today);
  const [newEventSummary, setNewEventSummary] = useState("");
  const [recurrenceFrequency, setRecurrenceFrequency] = useState("NONE");
  const [recurrenceCount, setRecurrenceCount] = useState(1);
  const [eventStartTime, setEventStartTime] = useState(
    today.toTimeString().slice(0, 5)
  );
  const [eventEndTime, setEventEndTime] = useState(
    new Date(today.getTime() + 60 * 60 * 1000).toTimeString().slice(0, 5)
  );

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function getEvents(d) {
    if (!calendarId || !isGoogleSignedIn || !isGapiLoaded) return;

    const startOfDay = new Date(d);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(d);
    endOfDay.setHours(23, 59, 59, 999);

    try {
      const response = await window.gapi.client.calendar.events.list({
        calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        showDeleted: false,
        singleEvents: true,
        maxResults: 25,
        orderBy: "startTime",
      });
      setEvents(response.result.items || []);
      setError(null);
    } catch (err) {
      console.error("Error fetching events: ", err);
      setError("Failed to fetch events. Check your permissions and calendar ID.");
    }
  }

  async function handleCreateEvent(e) {
    e.preventDefault();

    if (!isGapiLoaded || !isGoogleSignedIn || !calendarId || !newEventSummary) {
      setError(
        "Cannot create event. Please enter a name and make sure you’re signed in."
      );
      return;
    }

    const startDate = new Date(date);
    const [sh, sm] = eventStartTime.split(":");
    startDate.setHours(parseInt(sh, 10), parseInt(sm, 10));

    const endDate = new Date(date);
    const [eh, em] = eventEndTime.split(":");
    endDate.setHours(parseInt(eh, 10), parseInt(em, 10));

    const event = {
      summary: newEventSummary.trim(),
      start: { dateTime: startDate.toISOString(), timeZone: tz },
      end: { dateTime: endDate.toISOString(), timeZone: tz },
    };

    if (recurrenceFrequency !== "NONE") {
      event.recurrence = [`RRULE:FREQ=${recurrenceFrequency};COUNT=${recurrenceCount}`];
    }

    try {
      await window.gapi.client.calendar.events.insert({
        calendarId,
        resource: event,
      });
      setNewEventSummary("");
      await getEvents(date);
    } catch (err) {
      console.error("Error adding event: ", err);
      setError("Failed to add event. Please check your permissions.");
    }
  }

  async function handleAddEvent() {
    if (!calendarId) {
      setError("Calendar ID not found.");
      return;
    }
    if (!isGapiLoaded || !isGoogleSignedIn) {
      setError("Please sign in and ensure Google API is ready.");
      return;
    }

    const event = {
      summary: "New Test Event",
      start: { dateTime: new Date().toISOString(), timeZone: tz },
      end: { dateTime: new Date(Date.now() + 3600000).toISOString(), timeZone: tz },
    };

    try {
      await window.gapi.client.calendar.events.insert({
        calendarId,
        resource: event,
      });
      await getEvents(date);
    } catch (err) {
      console.error("Error adding event: ", err);
      setError("Failed to add event. Please check your permissions.");
    }
  }

  useEffect(() => {
    async function bootstrap() {
      try {
        // 1) Verify app session
        const meRes = await fetch("http://localhost:3000/api/me", {
          credentials: "include",
        });
        if (!meRes.ok) throw new Error("Not authenticated with the app.");
        setIsGoogleSignedIn(true);

        // 2) Get Google access token from your backend
        const tokenRes = await fetch("http://localhost:3000/api/auth/token", {
          credentials: "include",
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.accessToken) throw new Error("Access token not found.");

        // 3) Init gapi client and Calendar v3
        await new Promise((resolve) => gapi.load("client:auth2", resolve));
        await window.gapi.client.load("calendar", "v3");
        setIsGapiLoaded(true);

        // 4) Set token for gapi
        gapi.auth.setToken({ access_token: tokenData.accessToken });

        // 5) Fetch the user’s calendar ID from your backend
        const calRes = await fetch("http://localhost:3000/api/calendar/id", {
          credentials: "include",
        });
        if (!calRes.ok) {
          if (calRes.status === 401) throw new Error("Unauthorized. Please log in.");
          throw new Error("Failed to fetch calendar ID.");
        }
        const data = await calRes.json();
        setCalendarID(data.calendarId);
      } catch (err) {
        console.error("Bootstrap error: ", err);
        setError("Failed to load calendar data. Are you signed in with Google?");
      } finally {
        setIsLoading(false);
      }
    }
    bootstrap();
  }, []);

  useEffect(() => {
    if (calendarId && isGapiLoaded && isGoogleSignedIn) {
      getEvents(date);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarId, isGapiLoaded, isGoogleSignedIn, date]);

  if (isLoading) {
    return <div className="App py-8">Loading calendar data...</div>;
  }

  return (
    <div className="App flex flex-col justify-center py-8 cp-stack">
      <h1 className="mb-4 text-2xl font-bold">Calendar Page</h1>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {/* Calendar card */}
      <div className="cp-card p-4">
        <p className="caption mb-2">Calendar ID: {calendarId || "—"}</p>
        <div className="flex flex-col items-center">
          <Calendar onChange={setDate} value={date} />
          <h2 className="mt-4 text-xl font-bold">
            Events for {date.toDateString()}
          </h2>

          {events.length > 0 ? (
            <ul>
              {events.map((evt) => (
                <li key={evt.id}>
                  <div className="event-card">
                    <Event description={evt.summary} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 caption">No events found for this day.</p>
          )}
        </div>
      </div>

      {/* Create Event card */}
      <div className="cp-card p-4">
        <h2 className="text-xl font-bold mb-4">Create New Event</h2>
        <form onSubmit={handleCreateEvent} className="create-event">
          <div className="field">
            <label htmlFor="event-name">Event Name:</label>
            <input
              id="event-name"
              type="text"
              value={newEventSummary}
              onChange={(e) => setNewEventSummary(e.target.value)}
              required
            />
          </div>

          <div className="time-grid">
            <div className="field">
              <label htmlFor="start-time">Start Time:</label>
              <input
                id="start-time"
                type="time"
                value={eventStartTime}
                onChange={(e) => setEventStartTime(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="end-time">End Time:</label>
              <input
                id="end-time"
                type="time"
                value={eventEndTime}
                onChange={(e) => setEventEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="recurrence-freq">Recurrence:</label>
            <select
              id="recurrence-freq"
              value={recurrenceFrequency}
              onChange={(e) => setRecurrenceFrequency(e.target.value)}
            >
              <option value="NONE">None</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </div>

          {recurrenceFrequency !== "NONE" && (
            <div className="field">
              <label htmlFor="recurrence-count">Number of occurrences:</label>
              <input
                id="recurrence-count"
                type="number"
                min="1"
                value={recurrenceCount}
                onChange={(e) =>
                  setRecurrenceCount(Math.max(1, Number(e.target.value || 1)))
                }
              />
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={
              !isGapiLoaded || !isGoogleSignedIn || !calendarId || !newEventSummary
            }
          >
            Create Event
          </button>
        </form>

        <button
          onClick={handleAddEvent}
          className="btn btn-secondary mt-4"
          disabled={!isGapiLoaded || !isGoogleSignedIn || !calendarId}
        >
          Add New Test Event
        </button>
      </div>
    </div>
  );
}
