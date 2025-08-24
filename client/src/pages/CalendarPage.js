import { useEffect, useState } from "react";
import { gapi } from 'gapi-script';
import Calendar from "react-calendar";
import 'react-calendar/dist/Calendar.css';
import Event from '../Components/Event.js';

export default function CalendarPage() {
  const [events, setEvents] = useState([]);
  const [calendarId, setCalendarID] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGapiLoaded, setIsGapiLoaded] = useState(false);
  const [isGoogleSignedIn, setIsGoogleSignedIn] = useState(false);
  const today = new Date();
  const [date, setDate] = useState(today);
  const [newEventSummary, setNewEventSummary] = useState('');
  const [recurrenceFrequency, setRecurrenceFrequency] = useState('NONE');
  const [recurrenceCount, setRecurrenceCount] = useState(1);
  const [eventStartTime, setEventStartTime] = useState(today.toTimeString().slice(0, 5));
  const [eventEndTime, setEventEndTime] = useState(new Date(today.getTime() + 60 * 60 * 1000).toTimeString().slice(0, 5));
  

  const getEvents = async (date) => {
    if (!calendarId || !isGoogleSignedIn || !isGapiLoaded) {
      console.log("getEvents: Gapi not loaded, user not signed in, or calendarId is missing.");
      return;
    }
          
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    try {
      const response = await window.gapi.client.calendar.events.list({
        calendarId: calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        showDeleted: false,
        singleEvents: true,
        maxResults: 10,
        orderBy: 'startTime',
      });
      setEvents(response.result.items || []);
      setError(null);
    } catch (err) {
      console.error("Error fetching events: ", err);
      setError("Failed to fetch events. Check your permissions and calendar ID.");
    }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();

    if (!isGapiLoaded || !isGoogleSignedIn || !calendarId || !newEventSummary) {
      setError("Cannot create event. Please enter an event name and ensure you are signed in.");
      return;
    }

    const startDate = new Date(date);
    const [startHours, startMinutes] = eventStartTime.split(':');
    startDate.setHours(parseInt(startHours, 10), parseInt(startMinutes, 10));

    const endDate = new Date(date);
    const [endHours, endMinutes] = eventEndTime.split(':');
    endDate.setHours(parseInt(endHours, 10), parseInt(endMinutes, 10));

    const event = {
      summary: newEventSummary,
      start: {
        dateTime: startDate.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };

    if (recurrenceFrequency !== 'NONE') {
      event.recurrence = [`RRULE:FREQ=${recurrenceFrequency};COUNT=${recurrenceCount}`];
    }

    try {
      await window.gapi.client.calendar.events.insert({
        calendarId: calendarId,
        resource: event,
      });
      alert('EVENT added successfully!');
      setNewEventSummary('');
      getEvents(date);
    } catch (err) {
      console.error("Error adding event: ", err);
      setError("Failed to add event. Please check your permissions.");
    }
  };

  const handleAddEvent = async() => {
    if (!calendarId) {
      setError("Calendar ID not found.");
      return;
    }
  
    if (!isGapiLoaded || !isGoogleSignedIn) {
      console.error("Gapi client not ready or user not signed in.");
      setError("Cannot add event. Please make sure you are logged in and the calendar ID is available.");
      return;
    }
  
    const event = {
      summary: 'New Test Event',
      start: {
        dateTime: new Date().toISOString(),
      },
      end: {
        dateTime: new Date(Date.now() + 3600000).toISOString(),
      },
    };
  
    try {
      await window.gapi.client.calendar.events.insert({
        calendarId: calendarId,
        resource: event,
      });
      alert('Event added successfully!');
      getEvents(date);
    } catch (err) {
      console.error("Error adding event: ", err);
      setError("Failed to add event. Please check your permissions.");
    }
  };

  useEffect(() => {
    const checkAuthAndFetchCalendarID = async () => {
      try {
        console.log("Fetching user...");
        const authResponse = await fetch('http://localhost:3000/api/me', {
          credentials: 'include'
        });
        if (!authResponse.ok) {
          throw new Error('User is not authenticated with the server.');
        }
        setIsGoogleSignedIn(true);
  
        const tokenResponse = await fetch ('http://localhost:3000/api/auth/token', {
          credentials: 'include'
        });
        const tokenData = await tokenResponse.json();
        if (!tokenData.accessToken) {
          throw new Error("Access token not found.");
        }
                  
        await new Promise((resolve) => gapi.load('client:auth2', resolve));
        await window.gapi.client.load('calendar', 'v3');
        setIsGapiLoaded(true);
  
        gapi.auth.setToken({
          access_token: tokenData.accessToken
        });
  
        console.log("Fetching calendar ID...");
        const response = await fetch('http://localhost:3000/api/calendar/id', {
          credentials: 'include'
        });
        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("Unauthorized. Please log in.");
          }
          throw new Error('Failed to fetch calendar ID.');
        }
        const data = await response.json();
        setCalendarID(data.calendarId);
        console.log("Fetched Calendar ID:", data.calendarId);
      } catch (err) {
        console.error("Error fetching calendar Id: ", err);
        setError("Failed to load calendar data. Are you signed in with Google?");
      } finally {
        setIsLoading(false);
      }
    }
    checkAuthAndFetchCalendarID();
  }, [])

  useEffect(() => {
    if (calendarId && isGapiLoaded && isGoogleSignedIn) {
      getEvents(date);
    }
  }, [calendarId, isGapiLoaded, isGoogleSignedIn, date]);

  const handleDateChange = (date) => {
    setDate(date);
  };

  if (isLoading) {
    return <div>Loading calendar data...</div>;
  }

  return (
    <div className="App flex flex-col justify-center py-8">
      <h1 className="mb-4 text-2xl font-bold">Calendar Page</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <p>Calendar ID: {calendarId}</p>
      <div className="flex flex-col items-center">
        <Calendar
          onChange={handleDateChange}
          value={date}
        />
        <h2 className="mt-4 text-xl font-bold">Events for {date.toDateString()}</h2>
        {events.length > 0 ? (
          <ul>
              {events?.map((event) => (
                <li key={event.id} className="flex justify-center">
                  <Event description={event.summary} />
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-4">No events found for this day.</p>
        )}
      </div>
      <div className="mt-8 border p-4 rounded-md">
        <h2 className="text-xl font-bold mb-4">Create New Event</h2>
        <form onSubmit={handleCreateEvent}>
          <div className="flex flex-col mb-4">
            <label htmlFor="event-name" className="mb-2">Event Name:</label>
            <input
              id="event-name"
              type="text"
              value={newEventSummary}
              onChange={(e) => setNewEventSummary(e.target.value)}
              className="p-2 border rounded-md"
              required
            />
          </div>
          <div className="flex flex-col md:flex-row md:space-x-4 mb-4">
            <div className="flex flex-col">
              <label htmlFor="start-time" className="mb-2">Start Time:</label>
              <input
                id="start-time"
                type="time"
                value={eventStartTime}
                onChange={(e) => setEventStartTime(e.target.value)}
                className="p-2 border rounded-md"
                required
              />
            </div>
            <div className="flex flex-col">
              <label htmlFor="end-time" className="mb-2">End Time:</label>
              <input
                id="end-time"
                type="time"
                value={eventEndTime}
                onChange={(e) => setEventEndTime(e.target.value)}
                className="p-2 border rounded-md"
                required
              />
            </div>
          </div>
          <div className="flex flex-col mb-4">
            <label htmlFor="recurrence-freq" className="mb-2">Recurrence:</label>
            <select
              id="recurrence-freq"
              value={recurrenceFrequency}
              onChange={(e) => setRecurrenceFrequency(e.target.value)}
              className="p-2 border rounded-md"
            >
              <option value="NONE">None</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </div>
          {recurrenceFrequency !== 'NONE' && (
            <div className="flex flex-col mb-4">
              <label htmlFor="recurrence-count" className="mb-2">Number of occurences:</label>
              <input
                id="recurrence-count"
                type="number"
                min="1"
                value={recurrenceCount}
                onChange={(e) => setRecurrenceCount(e.target.value)}
                className="p-2 border rounded-md"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={!isGapiLoaded || !isGoogleSignedIn || !calendarId || !newEventSummary}
            className="w-full px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:bg-gray-400"
          >
            Create Event
          </button>
        </form>
      </div>
      <button
        onClick={handleAddEvent}
        disabled={!isGapiLoaded || !isGoogleSignedIn || !calendarId}
        className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-400"
      >
        Add New Test Event
      </button>
    </div>
  );
}
