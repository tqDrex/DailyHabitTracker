// passport.js
const passport = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const argon2 = require("argon2");
const { google } = require("googleapis");
const { OAuth2 } = google.auth;

/* ----------------- helpers ----------------- */
function generateTempPassword(length = 16) {
  const crypto = require("crypto");
  const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowers = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*()-_=+[]{};:,.?";
  const all = uppers + lowers + digits + symbols;
  const rb = () => crypto.randomBytes(1)[0];
  const pick = (set) => set[Math.floor((rb() / 256) * set.length)];
  const pwd = [pick(uppers), pick(lowers), pick(digits), pick(symbols)];
  while (pwd.length < length) pwd.push(pick(all));
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = rb() % (i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }
  return pwd.join("");
}

// Normalize seconds → ms if needed
function toMs(v) {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

async function saveGoogleTokensIfAny(db, userID, { accessToken, refreshToken, expiryDateMs }) {
  const sets = [];
  const vals = [];
  let i = 1;

  if (accessToken) { sets.push(`google_access_token = $${i++}`); vals.push(accessToken); }
  if (refreshToken) { sets.push(`google_refresh_token = $${i++}`); vals.push(refreshToken); }
  if (expiryDateMs != null) { sets.push(`google_token_expiry = $${i++}`); vals.push(Number(expiryDateMs)); }

  if (!sets.length) return;
  vals.push(userID);
  const sql = `UPDATE users SET ${sets.join(", ")} WHERE id = $${i}`;
  await db.query(sql, vals).catch((e) => {
    console.error(`Failed to save Google tokens for user ID ${userID}:`, e);
  });
}

async function ensureAppCalendar({ db, user, CONFIG }) {
  try {
    // Need at least one token to attempt Google API
    if (!user.google_access_token && !user.google_refresh_token) {
      return;
    }

    // Skip if we already created it
    const { rows } = await db.query("SELECT app_calendar_id FROM users WHERE id = $1", [user.id]);
    const appCalendarID = rows?.[0]?.app_calendar_id ?? null;
    if (appCalendarID) return;

    const oauth = new OAuth2(
      CONFIG.GOOGLE.CLIENT_ID,
      CONFIG.GOOGLE.CLIENT_SECRET,
      CONFIG.OAUTH_CALLBACK_URL
    );
    oauth.setCredentials({
      access_token: user.google_access_token || undefined,
      refresh_token: user.google_refresh_token || undefined,
      expiry_date: toMs(user.google_token_expiry),
    });

    const calendar = google.calendar({ version: "v3", auth: oauth });

    // Create a dedicated calendar (requires calendar scope)
    const { data } = await calendar.calendars.insert({
      requestBody: {
        summary: "EarlyBirdDailyHabitTracker",
        timeZone: "America/New_York",
      },
    });

    await db.query("UPDATE users SET app_calendar_id = $1 WHERE id = $2", [data.id, user.id]);
  } catch (err) {
    // Common causes: missing calendar scope, invalid/expired tokens, no refresh token
    const details = err?.response?.data || err?.message || err;
    console.error("ensureAppCalendar error:", details);
  }
}

/* ----------------- main export ----------------- */
module.exports = function configureGoogle({ CONFIG, users, db, mailer, auth }) {
  passport.serializeUser(function (user, done) {
    // keep as username if your session logic expects it
    done(null, user.username);
  });

  passport.deserializeUser(async function (username, done) {
    try {
      const { rows } = await users.getByUsername(username);
      const user = rows[0] || null;
      done(null, user);
    } catch (err) {
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

          // ----- Linking flow (user already logged in) -----
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
              expiryDateMs: undefined, // passport-google-oauth20 typically doesn't give expiry here
            });

            await ensureAppCalendar({ db, user: updated.rows[0], CONFIG });
            return done(null, updated.rows[0]);
          }

          // ----- Sign-in path: existing Google link? -----
          const byGoogle = await users.getByGoogleId(googleId);
          if (byGoogle.rows.length) {
            const user = byGoogle.rows[0];
            await saveGoogleTokensIfAny(db, user.id, { accessToken, refreshToken, expiryDateMs: undefined });

            // pass tokens forward for calendar step
            user.google_access_token = accessToken || user.google_access_token;
            user.google_refresh_token = refreshToken || user.google_refresh_token;

            await ensureAppCalendar({ db, user, CONFIG });
            return done(null, user);
          }

          // ----- Sign-in path: existing by email? (link them) -----
          if (email) {
            const byEmail = await users.getByEmail(email);
            if (byEmail.rows.length) {
              const user = byEmail.rows[0];

              await users.linkGoogleToUser({ googleId, name, avatarUrl, userId: user.id });
              if (emailVerified && !user.email) {
                await users.setEmail(user.username, email);
              }
              await saveGoogleTokensIfAny(db, user.id, { accessToken, refreshToken, expiryDateMs: undefined });

              const linked = await db.query("SELECT * FROM users WHERE id = $1", [user.id]);
              await ensureAppCalendar({ db, user: linked.rows[0], CONFIG });
              return done(null, linked.rows[0]);
            }
          }

          // ----- New user from Google profile -----
          let usernameCandidate = email ? email.split("@")[0] : `google-${googleId}`;
          let counter = 1;
          while (await users.usernameExists(usernameCandidate)) {
            usernameCandidate = email
              ? `${email.split("@")[0]}${counter++}`
              : `google-${googleId}-${counter++}`;
          }

          // If going passwordless, set a temp password and require change
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

          await saveGoogleTokensIfAny(db, createdUser.id, { accessToken, refreshToken, expiryDateMs: undefined });

          // keep tokens on the object for calendar step
          createdUser.google_access_token = accessToken;
          createdUser.google_refresh_token = refreshToken;

          await ensureAppCalendar({ db, user: createdUser, CONFIG });

          // Send temp password if we have an email
          if (email) {
            try {
              await mailer.sendPlain(
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
            } catch (err) {
              console.error("Temp password email error:", err);
              console.log(`[DEV ONLY] Temp password for ${usernameCandidate}: ${tempPassword}`);
            }
          } else {
            // no email available
            console.log(`[DEV ONLY] Temp password for ${usernameCandidate}: ${tempPassword}`);
          }

          return done(null, createdUser);
        } catch (e) {
          console.error("Google verify error:", e?.response?.data || e);
          return done(e);
        }
      }
    )
  );
};
