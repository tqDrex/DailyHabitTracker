const express = require("express");
const asyncHandler = require("../utils/asyncHandler");

module.exports = function buildCalendarRoutes({auth, users}) {
    const router = express.Router();
    const authorize = auth.getAuthorizeMiddleware();

    router.get(
        "/api/calendar/id",
        authorize,
        asyncHandler(async (req, res) => {
            const username = auth.getLoggedInUsername(req);
            if (!username) {
                return res.status(401).json({error: "Not authenticated" });
            }

            const profile = (await users.getPublicProfile(username));
            if (!profile || !profile.app_calendar_id) {
                return res.status(404).json({error: "Calendar ID not found. Have you signed in with Google?" });
            }

            res.json({calendarId: profile.app_calendar_id});
        })
    );

    return router;
};