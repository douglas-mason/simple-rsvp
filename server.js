const express = require('express');
const path = require('path');

// Load settings from .env when present. Skipped under Jest so a developer's
// local .env cannot change the PIN the tests expect.
if (process.env.NODE_ENV !== 'test') {
  try {
    process.loadEnvFile(path.join(__dirname, '.env'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CLEAR_AFTER_HOURS = parseFloat(process.env.CLEAR_AFTER_HOURS) || 48;
const CLEAR_AFTER_MS = CLEAR_AFTER_HOURS * 60 * 60 * 1000;
const DEFAULT_PIN = '0000';
const CANCEL_PIN = String(process.env.CANCEL_PIN || DEFAULT_PIN);

// Failed PIN attempts are limited per client IP: after PIN_MAX_FAILURES wrong
// guesses, every PIN endpoint returns 429 until the window expires.
const PIN_MAX_FAILURES = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000;
const pinFailures = new Map();

function pruneExpiredFailures(now) {
  pinFailures.forEach(function(entry, key) {
    if (entry.resetAt <= now) pinFailures.delete(key);
  });
}

// Sends the error response and returns false when the PIN is wrong or the
// client is locked out; returns true when the request may proceed.
function checkPin(req, res) {
  var now = Date.now();
  var key = req.ip;
  var entry = pinFailures.get(key);
  if (entry && entry.resetAt <= now) {
    pinFailures.delete(key);
    entry = null;
  }
  if (entry && entry.count >= PIN_MAX_FAILURES) {
    res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    res.status(429).json({ error: 'Too many incorrect PIN attempts. Try again later.' });
    return false;
  }
  if (String(req.body.pin) !== CANCEL_PIN) {
    if (!entry) {
      pruneExpiredFailures(now);
      entry = { count: 0, resetAt: now + PIN_WINDOW_MS };
      pinFailures.set(key, entry);
    }
    entry.count++;
    res.status(401).json({ error: 'Incorrect PIN' });
    return false;
  }
  return true;
}

let state = {
  cancelled: false,
  rsvps: [],
  clearsAt: null,
};

let clearTimer = null;

function scheduleClears() {
  if (clearTimer) clearTimeout(clearTimer);
  const clearsAt = new Date(Date.now() + CLEAR_AFTER_MS);
  state.clearsAt = clearsAt.toISOString();
  clearTimer = setTimeout(function() {
    state.cancelled = false;
    state.rsvps = [];
    state.clearsAt = null;
    clearTimer = null;
  }, CLEAR_AFTER_MS);
}

function maybeStartTimer() {
  if (!clearTimer) scheduleClears();
}

app.get('/api/state', function(req, res) {
  res.json({ cancelled: state.cancelled, rsvps: state.rsvps, clearsAt: state.clearsAt });
});

app.post('/api/rsvp', function(req, res) {
  var name = req.body.name, attending = req.body.attending, guests = req.body.guests;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (typeof attending !== 'boolean') {
    return res.status(400).json({ error: 'attending must be a boolean' });
  }
  var trimmedName = name.trim();
  var guestCount = Math.max(0, parseInt(guests) || 0);
  var existing = state.rsvps.find(function(r) {
    return r.name.toLowerCase() === trimmedName.toLowerCase();
  });
  if (existing) {
    existing.attending = attending;
    existing.guests = guestCount;
    existing.timestamp = new Date().toISOString();
  } else {
    state.rsvps.push({ name: trimmedName, attending: attending, guests: guestCount, timestamp: new Date().toISOString() });
    maybeStartTimer();
  }
  res.json({ ok: true, rsvps: state.rsvps, clearsAt: state.clearsAt });
});

app.delete('/api/rsvp', function(req, res) {
  var name = req.body.name;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  var trimmedName = name.trim();
  state.rsvps = state.rsvps.filter(function(r) {
    return r.name.toLowerCase() !== trimmedName.toLowerCase();
  });
  res.json({ ok: true, rsvps: state.rsvps });
});

app.post('/api/cancel', function(req, res) {
  if (!checkPin(req, res)) return;
  state.cancelled = true;
  maybeStartTimer();
  res.json({ ok: true, cancelled: state.cancelled, clearsAt: state.clearsAt });
});

app.post('/api/uncancel', function(req, res) {
  if (!checkPin(req, res)) return;
  state.cancelled = false;
  res.json({ ok: true, cancelled: state.cancelled });
});

app.post('/api/verify-pin', function(req, res) {
  if (!checkPin(req, res)) return;
  res.json({ ok: true });
});

app.post('/api/reset', function(req, res) {
  if (!checkPin(req, res)) return;
  state.rsvps = [];
  state.cancelled = false;
  if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
  state.clearsAt = null;
  res.json({ ok: true, cancelled: state.cancelled, rsvps: state.rsvps, clearsAt: state.clearsAt });
});

function resetState() {
  if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
  state.cancelled = false;
  state.rsvps = [];
  state.clearsAt = null;
  pinFailures.clear();
}

if (require.main === module) {
  var PORT = process.env.PORT || 3000;
  app.listen(PORT, function() {
    console.log('Simple RSVP server running on http://localhost:' + PORT);
    console.log('Auto-clear after ' + CLEAR_AFTER_HOURS + ' hours');
    if (CANCEL_PIN === DEFAULT_PIN) {
      console.warn('WARNING: using the default PIN ' + DEFAULT_PIN + '. Set CANCEL_PIN in .env before deploying.');
    }
  });
}

module.exports = { app, resetState };
