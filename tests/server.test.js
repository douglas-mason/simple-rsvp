const request = require('supertest');
const { app, resetState } = require('../server');

const PIN = '0000';
const WRONG_PIN = '9999';

beforeEach(() => resetState());
afterAll(() => resetState());

// ---------------------------------------------------------------------------
// GET /api/state
// ---------------------------------------------------------------------------

describe('GET /api/state', () => {
  it('returns initial state', async () => {
    const res = await request(app).get('/api/state');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: false, rsvps: [], clearsAt: null });
  });

  it('reflects RSVPs after they are added', async () => {
    await request(app)
      .post('/api/rsvp')
      .send({ name: 'Alice', attending: true, guests: 0 });

    const res = await request(app).get('/api/state');
    expect(res.body.rsvps).toHaveLength(1);
    expect(res.body.rsvps[0].name).toBe('Alice');
  });
});

// ---------------------------------------------------------------------------
// POST /api/rsvp
// ---------------------------------------------------------------------------

describe('POST /api/rsvp', () => {
  it('adds a new RSVP', async () => {
    const res = await request(app)
      .post('/api/rsvp')
      .send({ name: 'Alice', attending: true, guests: 2 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.rsvps).toHaveLength(1);
    expect(res.body.rsvps[0]).toMatchObject({ name: 'Alice', attending: true, guests: 2 });
  });

  it('trims whitespace from name', async () => {
    const res = await request(app)
      .post('/api/rsvp')
      .send({ name: '  Bob  ', attending: true, guests: 0 });

    expect(res.body.rsvps[0].name).toBe('Bob');
  });

  it('updates an existing RSVP (case-insensitive match)', async () => {
    await request(app).post('/api/rsvp').send({ name: 'Alice', attending: true, guests: 0 });
    const res = await request(app)
      .post('/api/rsvp')
      .send({ name: 'alice', attending: false, guests: 1 });

    expect(res.body.rsvps).toHaveLength(1);
    expect(res.body.rsvps[0]).toMatchObject({ attending: false, guests: 1 });
  });

  it('clamps negative guest count to 0', async () => {
    const res = await request(app)
      .post('/api/rsvp')
      .send({ name: 'Alice', attending: true, guests: -3 });

    expect(res.body.rsvps[0].guests).toBe(0);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/rsvp')
      .send({ attending: true, guests: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('returns 400 when name is blank', async () => {
    const res = await request(app)
      .post('/api/rsvp')
      .send({ name: '   ', attending: true, guests: 0 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when attending is not a boolean', async () => {
    const res = await request(app)
      .post('/api/rsvp')
      .send({ name: 'Alice', attending: 'yes', guests: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/attending/i);
  });

  it('sets a clearsAt timestamp after first RSVP', async () => {
    const res = await request(app)
      .post('/api/rsvp')
      .send({ name: 'Alice', attending: true, guests: 0 });

    expect(res.body.clearsAt).not.toBeNull();
    expect(new Date(res.body.clearsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('includes a timestamp on each RSVP', async () => {
    const res = await request(app)
      .post('/api/rsvp')
      .send({ name: 'Alice', attending: true, guests: 0 });

    expect(res.body.rsvps[0].timestamp).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/rsvp
// ---------------------------------------------------------------------------

describe('DELETE /api/rsvp', () => {
  beforeEach(async () => {
    await request(app).post('/api/rsvp').send({ name: 'Alice', attending: true, guests: 0 });
    await request(app).post('/api/rsvp').send({ name: 'Bob', attending: true, guests: 0 });
  });

  it('removes the named RSVP', async () => {
    const res = await request(app)
      .delete('/api/rsvp')
      .send({ name: 'Alice' });

    expect(res.status).toBe(200);
    expect(res.body.rsvps.find(r => r.name === 'Alice')).toBeUndefined();
    expect(res.body.rsvps).toHaveLength(1);
  });

  it('is case-insensitive', async () => {
    const res = await request(app)
      .delete('/api/rsvp')
      .send({ name: 'ALICE' });

    expect(res.body.rsvps.find(r => r.name.toLowerCase() === 'alice')).toBeUndefined();
  });

  it('succeeds silently when name is not found', async () => {
    const res = await request(app)
      .delete('/api/rsvp')
      .send({ name: 'Nobody' });

    expect(res.status).toBe(200);
    expect(res.body.rsvps).toHaveLength(2);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).delete('/api/rsvp').send({});
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/cancel
// ---------------------------------------------------------------------------

describe('POST /api/cancel', () => {
  it('returns 401 with wrong PIN', async () => {
    const res = await request(app).post('/api/cancel').send({ pin: WRONG_PIN });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  it('cancels the game with correct PIN', async () => {
    const res = await request(app).post('/api/cancel').send({ pin: PIN });
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(true);
  });

  it('sets a clearsAt timestamp', async () => {
    const res = await request(app).post('/api/cancel').send({ pin: PIN });
    expect(res.body.clearsAt).not.toBeNull();
  });

  it('does not cancel when PIN is missing', async () => {
    const res = await request(app).post('/api/cancel').send({});
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/uncancel
// ---------------------------------------------------------------------------

describe('POST /api/uncancel', () => {
  beforeEach(async () => {
    await request(app).post('/api/cancel').send({ pin: PIN });
  });

  it('returns 401 with wrong PIN', async () => {
    const res = await request(app).post('/api/uncancel').send({ pin: WRONG_PIN });
    expect(res.status).toBe(401);
  });

  it('uncancels the game with correct PIN', async () => {
    const res = await request(app).post('/api/uncancel').send({ pin: PIN });
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(false);
  });

  it('state reflects uncancelled after uncancel', async () => {
    await request(app).post('/api/uncancel').send({ pin: PIN });
    const state = await request(app).get('/api/state');
    expect(state.body.cancelled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/verify-pin
// ---------------------------------------------------------------------------

describe('POST /api/verify-pin', () => {
  it('returns 401 with wrong PIN', async () => {
    const res = await request(app).post('/api/verify-pin').send({ pin: WRONG_PIN });
    expect(res.status).toBe(401);
  });

  it('returns ok with correct PIN', async () => {
    const res = await request(app).post('/api/verify-pin').send({ pin: PIN });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('does not mutate game state', async () => {
    await request(app).post('/api/rsvp').send({ name: 'Alice', attending: true, guests: 0 });
    await request(app).post('/api/cancel').send({ pin: PIN });

    await request(app).post('/api/verify-pin').send({ pin: PIN });

    const state = await request(app).get('/api/state');
    expect(state.body.cancelled).toBe(true);
    expect(state.body.rsvps).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/reset
// ---------------------------------------------------------------------------

describe('POST /api/reset', () => {
  beforeEach(async () => {
    await request(app).post('/api/rsvp').send({ name: 'Alice', attending: true, guests: 1 });
    await request(app).post('/api/rsvp').send({ name: 'Bob', attending: false, guests: 0 });
    await request(app).post('/api/cancel').send({ pin: PIN });
  });

  it('returns 401 with wrong PIN', async () => {
    const res = await request(app).post('/api/reset').send({ pin: WRONG_PIN });
    expect(res.status).toBe(401);
  });

  it('clears all RSVPs', async () => {
    const res = await request(app).post('/api/reset').send({ pin: PIN });
    expect(res.status).toBe(200);
    expect(res.body.rsvps).toHaveLength(0);
  });

  it('resets cancelled to false', async () => {
    const res = await request(app).post('/api/reset').send({ pin: PIN });
    expect(res.body.cancelled).toBe(false);
  });

  it('clears clearsAt', async () => {
    const res = await request(app).post('/api/reset').send({ pin: PIN });
    expect(res.body.clearsAt).toBeNull();
  });

  it('state reflects reset values after the call', async () => {
    await request(app).post('/api/reset').send({ pin: PIN });
    const state = await request(app).get('/api/state');
    expect(state.body).toEqual({ cancelled: false, rsvps: [], clearsAt: null });
  });

  it('preserves RSVPs when wrong PIN provided', async () => {
    await request(app).post('/api/reset').send({ pin: WRONG_PIN });
    const state = await request(app).get('/api/state');
    expect(state.body.rsvps).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// PIN rate limiting
// ---------------------------------------------------------------------------

describe('PIN rate limiting', () => {
  const MAX_FAILURES = 5;
  const WINDOW_MS = 15 * 60 * 1000;

  async function failPin(times, endpoint) {
    for (let i = 0; i < times; i++) {
      const res = await request(app).post(endpoint || '/api/verify-pin').send({ pin: WRONG_PIN });
      expect(res.status).toBe(401);
    }
  }

  afterEach(() => {
    jest.restoreAllMocks();
    app.set('trust proxy', false);
  });

  it('allows up to the limit of wrong guesses with 401s', async () => {
    await failPin(MAX_FAILURES);
  });

  it('returns 429 with Retry-After once the limit is reached', async () => {
    await failPin(MAX_FAILURES);
    const res = await request(app).post('/api/verify-pin').send({ pin: WRONG_PIN });
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('rejects even the correct PIN while locked out', async () => {
    await failPin(MAX_FAILURES);
    const res = await request(app).post('/api/verify-pin').send({ pin: PIN });
    expect(res.status).toBe(429);
  });

  it('shares the limit across all PIN endpoints', async () => {
    await failPin(MAX_FAILURES, '/api/verify-pin');
    for (const endpoint of ['/api/cancel', '/api/uncancel', '/api/reset']) {
      const res = await request(app).post(endpoint).send({ pin: PIN });
      expect(res.status).toBe(429);
    }
  });

  it('does not change state when locked out', async () => {
    await request(app).post('/api/rsvp').send({ name: 'Alice', attending: true, guests: 0 });
    await failPin(MAX_FAILURES);
    await request(app).post('/api/reset').send({ pin: PIN });
    await request(app).post('/api/cancel').send({ pin: PIN });
    const state = await request(app).get('/api/state');
    expect(state.body.rsvps).toHaveLength(1);
    expect(state.body.cancelled).toBe(false);
  });

  it('does not count correct PINs as failures', async () => {
    for (let i = 0; i < MAX_FAILURES + 2; i++) {
      const res = await request(app).post('/api/verify-pin').send({ pin: PIN });
      expect(res.status).toBe(200);
    }
  });

  it('unlocks after the window expires', async () => {
    const start = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(start);
    await failPin(MAX_FAILURES);
    Date.now.mockReturnValue(start + WINDOW_MS + 1);
    const res = await request(app).post('/api/verify-pin').send({ pin: PIN });
    expect(res.status).toBe(200);
  });

  it('tracks each client IP separately', async () => {
    app.set('trust proxy', true);
    for (let i = 0; i < MAX_FAILURES; i++) {
      await request(app).post('/api/verify-pin').set('X-Forwarded-For', '10.0.0.1').send({ pin: WRONG_PIN });
    }
    const blocked = await request(app).post('/api/verify-pin').set('X-Forwarded-For', '10.0.0.1').send({ pin: PIN });
    expect(blocked.status).toBe(429);
    const other = await request(app).post('/api/verify-pin').set('X-Forwarded-For', '10.0.0.2').send({ pin: PIN });
    expect(other.status).toBe(200);
  });
});
