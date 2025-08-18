// passport.js
const passport = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const argon2 = require("argon2");
const { access } = require("fs");
const { google } = require('googleapis');
const { OAuth2 } = google.auth;

function generateTempPassword(length = 16) {
  const crypto = require("crypto");
  const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowers = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*()-_=+[]{};:,.?";
  const all = uppers + lowers + digits + symbols;
  const rb = () => crypto.randomBytes(1)[0];
  const pick = (set) => set[Math.floor((rb() / 256) * set.length)];
  let pwd = [pick(uppers), pick(lowers), pick(digits), pick(symbols)];
  while (pwd.length < length) pwd.push(pick(all));
  for (let i = pwd.length - 1; i > 0; i--) { const j = rb() % (i + 1); [pwd[i], pwd[j]] = [pwd[j], pwd[i]]; }
  return pwd.join("");
}

async function saveGoogleTokensIfAny(db, userID, { accessToken, refreshToken, expiryDateMs }) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (accessToken) { fields.push(`google_access_token = $${idx++}`); values.push(accessToken); }
  if (refreshToken) { fields.push(`google_refresh_token = $${idx++}`); values.push(refreshToken); }
  if (expiryDateMs) { fields.push(`google_token_expiry = $${idx++} / 1000.0`); values.push(expiryDateMs); }

  if (!fields.length) return;

  values.push(userID);
  const sql = `UPDATE users SET ${fields.join(", ")} WHERE id = $${idx}`;
  await db.query(sql, values).catch((e) => {
    console.error(`Failed to save Google tokens for user ID: ${userID}: `, e);
  });
  console.log(`Successfully saved Google tokens for user ID: ${userID}`);
}

async function ensureAppCalendar({db, user, CONFIG}) {
  try {
    console.log("ensureAppCalendar: checking user tokens...");
    if (!user.google_access_token && !user.google_refresh_token) {
      console.log("ensureAppCalendar: No access or refresh token found. Exiting."); 
      return;
    }
    console.log("ensureAppCalendar: Tokens are present.");

    let appCalendarID = null;
    console.log("ensureAppCalendar: Checking for existing app calendar ID...");
    try {
      const {rows} = await db.query("SELECT app_calendar_id FROM users WHERE id=$1", [user.id]);
      appCalendarID = rows?.[0]?.app_calendar_id ?? null;
      console.log("ensureAppCalendar: Found existing appCalendarID in DB: " + appCalendarID);
    } catch (e) {
      console.error("ensureAppCalendar: Error checking for existing calendar ID:", e);
      return;
    }
    if (appCalendarID) { 
      console.log("ensureAppCalendar: Calendar ID already exists. Exiting.");
      return;
    }

    console.log("ensureAppCalendar: Attempting to create new calendar...");
    const oauth = new OAuth2(
      CONFIG.GOOGLE.CLIENT_ID,
      CONFIG.GOOGLE.CLIENT_SECRET,
      CONFIG.OAUTH_CALLBACK_URL
    );
    oauth.setCredentials({
      access_token: user.google_access_token || undefined,
      refresh_token: user.google_refresh_token || undefined,

      expiry_date: user.google_token_expiry ? new Date(user.google_token_expiry).getTime() : undefined,
    });
    console.log("ensureAppCalendar: OAuth credentials set. Access Token present:", !!user.google_access_token);
    console.log("ensureAppCalendar: Refresh Token present:", !!user.google_refresh_token);
    console.log("ensureAppCalendar: Expiry date set:", !!user.google_token_expiry);

    const calendar = google.calendar({version: "v3", auth: oauth});

    console.log("ensureAppCalendar: Sending request to Google Calendar API to insert calendar...");
    const {data} = await calendar.calendars.insert({
      requestBody: {
        summary: "EarlyBirdDailyHabitTracker",
        timeZone: "America/New_York",
      },
    });
    console.log("ensureAppCalendar: Successfully created new calendar. Received ID:", data.id);

    console.log("ensureAppCalendar: Attempting to update database with new calendar ID...");
    await db.query("UPDATE users SET app_calendar_id=$1 WHERE id=$2", [data.id, user.id]);
    //Silent below
    //await db.query("UPDATE users SET app_calendar_id=$1 WHERE id=$2", [data.id, user.id]).catch(() => {});
    console.log("ensureAppCalendar: Successfully updated database with ID: " + data.id);
  } catch (err) {
    console.error("ensureAppCalendar error: ", err?.response?.data || err);
    console.error("ensureAppCalendar FATAL ERROR:", err);

  /*
    // Check for a specific Google API error response
    if (err.response && err.response.data && err.response.data.error) {
      const apiError = err.response.data.error;
      console.error("Google API Error:");
      console.error("  Code:", apiError.code);
      console.error("  Message:", apiError.message);
    }

    if (apiError.errors && apiError.errors.length > 0) {
      console.error("  Specific errors:");
      apiError.errors.forEach(specificError => {
        console.error("    Reason:", specificError.reason);
        console.error("    Message:", specificError.message);
      });
    } else {
      console.error("Non-API Error:", err.message || err);
    }
      */
  }
}

module.exports = function configureGoogle({ CONFIG, users, db, mailer, auth }) {
  passport.serializeUser(function(user, done) {
    done(null, user.username);
  });

  passport.deserializeUser(async function(username, done) {
    try {
      console.log(`Deserializing user with username: ${username}`);
      const {rows} = await users.getByUsername(username);
      const user = rows[0] || null;
      if (user) {
        console.log(`Successfully deserialized user: ${user.username}`);
      } else {
        console.error(`Failed to deserialize user. Username not found: ${username}`);
      }
      done(null, user);
    } catch (err) {
      console.error("Error during deserialization:", err);
      done(err);
    }
  });

  passport.use(
    new GoogleStrategy(
      {
        clientID: CONFIG.GOOGLE.CLIENT_ID,
        clientSecret: CONFIG.GOOGLE.CLIENT_SECRET,
        callbackURL: CONFIG.OAUTH_CALLBACK_URL,
        passReqToCallback: true,
      },
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          const googleId = profile.id;
          const email = (profile.emails?.[0]?.value || "").toLowerCase() || null;
          const name = profile.displayName || null;
          const avatarUrl = profile.photos?.[0]?.value || null;
          const emailVerified =
            (profile._json && (profile._json.email_verified || profile._json.verified_email)) || false;

          const currentUsername = auth.getLoggedInUsername(req);

          // Linking (already logged in)
          if (currentUsername) {
            const existingByGoogle = await users.getByGoogleId(googleId);
            if (existingByGoogle.rows.length && existingByGoogle.rows[0].username !== currentUsername) {
              return done(null, false, { message: "This Google account is already linked to another user." });
            }
            if (email) {
              const owner = await users.getByEmail(email);
              if (owner.rows.length && owner.rows[0].username !== currentUsername) {
                return done(null, false, { message: "That email is used by another account." });
              }
            }
            await users.updateProfileByUsername({
              googleId,
              email: emailVerified ? email : null,
              name,
              avatarUrl,
              username: currentUsername,
            });
            const updated = await users.getByUsername(currentUsername);
            await saveGoogleTokensIfAny(db, updated.rows[0].id, {
              accessToken,
              refreshToken,
              expiryDateMs: undefined,
            });

            await ensureAppCalendar({db, user: updated.rows[0], CONFIG});
            
            return done(null, updated.rows[0]);
          }

          // Sign-in / Sign-up
          const byGoogle = await users.getByGoogleId(googleId);
          if (byGoogle.rows.length) { 
            const user = byGoogle.rows[0];

            await saveGoogleTokensIfAny(db, user.id, {accessToken, refreshToken, expiryDateMs: undefined});

            user.google_access_token = accessToken;
            user.google_refresh_token = refreshToken;

            await ensureAppCalendar({db, user, CONFIG});
            return done(null, user); 
          }

          if (email) {
            const byEmail = await users.getByEmail(email);
            if (byEmail.rows.length) {
              const user = byEmail.rows[0];

              await users.linkGoogleToUser({ googleId, name, avatarUrl, userId: user.id });
              if (emailVerified && !user.email) {
                await users.setEmail(user.username, email);
              }
              await saveGoogleTokensIfAny(db, user.id, {accessToken, refreshToken, expiryDateMs: undefined});

              user.google_access_token = accessToken;
              user.google_refresh_token = refreshToken;

              const linked = await db.query("SELECT * FROM users WHERE id = $1", [user.id]);
              
              await ensureAppCalendar({db, user: linked.rows[0], CONFIG});

              return done(null, linked.rows[0]);
            }
          }

          // New user from Google profile
          let usernameCandidate = email ? email.split("@")[0] : `google-${googleId}`;
          let counter = 1;
          while (await users.usernameExists(usernameCandidate)) {
            usernameCandidate = email ? `${email.split("@")[0]}${counter++}` : `google-${googleId}-${counter++}`;
          }

          // If going passwordless, set hash=null and mustChange=false
          const tempPassword = generateTempPassword(16);
          const tempHash = await argon2.hash(tempPassword);

          const createdUser = await users.createFromGoogle({
            username: usernameCandidate,
            hash: tempHash,
            email: emailVerified ? email : null,
            googleId,
            name,
            avatarUrl,
            mustChange: true,
          });

          await saveGoogleTokensIfAny(db, createdUser.id, {accessToken, refreshToken, expiryDateMs: undefined});

          createdUser.google_access_token = accessToken;
          createdUser.google_refresh_token = refreshToken;

          await ensureAppCalendar({ db, user: createdUser, CONFIG});

          try {
            const mailed = await mailer.sendPlain(
              email,
              "Your temporary password",
              `Hi ${name || usernameCandidate},

Your account has been created.
Username: ${usernameCandidate}
Temporary password: ${tempPassword}

Change it at: ${new URL(CONFIG.FRONTEND_URL).origin}/change-password

If you didn't request this, ignore this email.

— ${new URL(CONFIG.FRONTEND_URL).host}`
            );
            if (!mailed) console.log(`[DEV ONLY] Temp password for ${usernameCandidate}: ${tempPassword}`);
          } catch (err) {
            console.error("Temp password email error:", err);
            console.log(`[DEV ONLY] Temp password for ${usernameCandidate}: ${tempPassword}`);
          }

          return done(null, createdUser);
        } catch (e) {
          console.error("Google verify error:", e);
          return done(e);
        }
      }
    )
  );
};
