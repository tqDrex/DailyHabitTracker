import React, { useEffect, useState } from 'react';
//import './App.css';
import { gapi } from 'gapi-script';
import Event from '../Components/Event.js';

const API = process.env.REACT_APP_API_LINK;

function Test() {
    const [events, setEvents] = useState([]);
    const [calendarId, setCalendarID] = useState(null);
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isGapiLoaded, setIsGapiLoaded] = useState(false);
    const [isGoogleSignedIn, setIsGoogleSignedIn] = useState(false);

    const getEvents = async () => {
        if (!calendarId || !isGoogleSignedIn || !isGapiLoaded) {
            console.log("getEvents: Gapi not loaded, user not signed in, or calendarId is missing.");
            return;
        }
        /*
        if (!window.gapi || !window.gapi.auth2 || !window.gapi.auth2.getAuthInstance().isSignedIn.get()) {
            console.log("gapi not loaded or user not signed in.");
            return;
        }
        */
        try {
            const response = await window.gapi.client.calendar.events.list({
                calendarId: calendarId,
                timeMin: (new Date()).toISOString(),
                showDeleted: false,
                singleEvents: true,
                maxResults: 10,
                orderBy: 'startTime',
            })
            setEvents(response.result.items || []);
            setError(null);
        } catch (err) {
            console.error("Error fetching events: ", err);
            setError("Failed to fetch events. Check your permissions and calendar ID.");
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
            getEvents();
        } catch (err) {
            console.error("Error adding event: ", err);
            setError("Failed to add event. Please check your permissions.");
        }
    };

    //console.log(process.env.REACT_APP_CALENDAR_ID + " :ci ak: " + process.env.REACT_APP_GOOGLE_API_KEY + " at: " + process.env.REACT_APP_GOOGLE_ACCESS_TOKEN);

    
    /*
    useEffect(() => {
        getEvents();      
    }, [calendarId])
    */
    

    const loadGapiClient = () => {
        gapi.load('client', () => {
            const apiKey = process.env.REACT_APP_GOOGLE_API_KEY;
            gapi.client.init({apiKey: apiKey}).then(() => {
                gapi.client.load('calendar', 'v3').then(() => {
                    setIsGapiLoaded(true);
                    const authInstance = gapi.auth2.getAuthInstance();
                    if (authInstance) {
                        setIsGoogleSignedIn(authInstance.isSignedIn.get());
                        authInstance.isSignedIn.listen(isSignedIn => setIsGoogleSignedIn(isSignedIn));
                    }
                }).catch(err => console.error("Error loading gapi calendar client: ", err));
            }).catch(err => console.error("Error initializing gapi client: ", err));
        });
    };
/*
    useEffect(() => {
        const loadAndAuth = async () => {
            try {
                // 1. Load the gapi client
                await new Promise((resolve, reject) => {
                    gapi.load('client:auth2', () => {
                        gapi.client.init({
                            apiKey: process.env.REACT_APP_GOOGLE_API_KEY,
                            clientId: process.env.REACT_APP_GOOGLE_CLIENT_ID,
                            scope: 'https://www.googleapis.com/auth/calendar.events',
                        }).then(resolve).catch(reject);
                    });
                });
                console.log("GAPI client loaded and initialized.");
                setIsGapiLoaded(true);

                // 2. Check auth status and set state
                const authInstance = gapi.auth2.getAuthInstance();
                if (authInstance) {
                    setIsGoogleSignedIn(authInstance.isSignedIn.get());
                    authInstance.isSignedIn.listen(isSignedIn => setIsGoogleSignedIn(isSignedIn));
                }

                // 3. Fetch the calendar ID
                console.log("Fetching calendar ID...");
                const response = await fetch('http://localhost:3000/api/calendar/id', {
                    credentials: 'include',
                });
                if (!response.ok) {
                    throw new Error("Failed to fetch calendar ID.");
                }
                const data = await response.json();
                setCalendarID(data.calendarId);
                console.log("Fetched Calendar ID:", data.calendarId);

            } catch (err) {
                console.error("Initialization error: ", err);
                setError("Initialization failed. Please check your credentials and network connection.");
            } finally {
                setIsLoading(false);
            }
        };

        loadAndAuth();
    }, []);
    */

    useEffect(() => {
        //loadGapiClient();
        
        const checkAuthAndFetchCalendarID = async () => {
            try {
                console.log("Fetching user...");
                const authResponse = await fetch(`${API}/api/me`, {
                    credentials: 'include'
                });
                if (!authResponse.ok) {
                    throw new Error('User is not authenticated.');
                }
                setIsGoogleSignedIn(true);

                const tokenResponse = await fetch (`${API}/api/auth/token`, {
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
                const response = await fetch(`${API}/api/calendar/id`, {
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
            getEvents();
        }
    }, [calendarId, isGapiLoaded, isGoogleSignedIn]);

    if (isLoading) {
        return <div>Loading calendar data...</div>;
    }

    return (
        <div className="App flex flex-col justify-center py-8">
            <h1 className="mb-4 text-2xl font-bold">
                React App with Google Calendar API!
            </h1>
            {error && <p style={{color: 'red'}}>{error}</p>}
            <p>Calendar ID: {calendarId}</p>
            <button 
                onClick={handleAddEvent}
                disabled={!isGapiLoaded || !isGoogleSignedIn || !calendarId}
                className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-400"
            >
                Add New Event
            </button>
            <ul>
                {events?.map((event) => (
                    <li key={event.id} className="flex justify-center">
                        <Event description={event.summary} />
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default Test