const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');

/**
 * Boot a fresh JSDOM window. fetch is mocked to return `initialState` for
 * every call; setInterval/clearInterval are no-ops so background polling
 * never fires during tests.
 *
 * `setup`, when given, runs against the fresh window before the page's inline
 * script executes — use it to seed localStorage or swap out browser APIs.
 */
function createWindow(initialState, setup) {
  if (!initialState) {
    initialState = { cancelled: false, rsvps: [], clearsAt: null };
  }

  return new Promise(function(resolve) {
    const dom = new JSDOM(HTML, {
      runScripts: 'dangerously',
      url: 'http://localhost:3000',
      beforeParse: function(window) {
        // Use window.Promise to avoid cross-context Promise issues.
        window._mockState = initialState;
        window.fetch = function() {
          var P = window.Promise;
          var state = window._mockState;
          return new P(function(res) {
            res({
              status: 200,
              json: function() {
                return new P(function(r) { r(state); });
              }
            });
          });
        };
        window.setInterval = function() { return 0; };
        window.clearInterval = function() {};
        if (setup) setup(window);
      }
    });

    // Give the fetch promise chain in init() time to resolve.
    setTimeout(function() { resolve(dom.window); }, 50);
  });
}

// ---------------------------------------------------------------------------
// escHtml
// ---------------------------------------------------------------------------

describe('escHtml()', () => {
  let w;
  beforeAll(async () => { w = await createWindow(); });
  afterAll(() => { w.close(); });

  it('escapes <', () => expect(w.escHtml('<div>')).toBe('&lt;div&gt;'));
  it('escapes >', () => expect(w.escHtml('a>b')).toBe('a&gt;b'));
  it('escapes &', () => expect(w.escHtml('a & b')).toBe('a &amp; b'));
  it('escapes "', () => expect(w.escHtml('"hello"')).toBe('&quot;hello&quot;'));
  it('escapes a full XSS payload', () => {
    const input = '<script>alert("xss")</script>';
    const expected = '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;';
    expect(w.escHtml(input)).toBe(expected);
  });
  it('leaves plain text unchanged', () => {
    expect(w.escHtml('John Smith')).toBe('John Smith');
  });
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('initial state', () => {
  let w;
  beforeAll(async () => { w = await createWindow(); });
  afterAll(() => { w.close(); });

  it('adminMode is false', () => expect(w.adminMode).toBe(false));
  it('attending is true', () => expect(w.attending).toBe(true));
  it('guests is 0', () => expect(w.guests).toBe(0));

  it('RSVP list shows empty-state message', () => {
    expect(w.document.querySelector('#rsvpList .empty-state')).not.toBeNull();
  });

  it('stats show 0 attending', () => {
    expect(w.document.getElementById('statsAttending').textContent).toBe('0 attending');
  });

  it('total is empty when nobody is attending', () => {
    expect(w.document.getElementById('statsTotal').textContent).toBe('');
  });

  it('header does not have admin-mode class', () => {
    expect(w.document.getElementById('siteHeader').classList.contains('admin-mode')).toBe(false);
  });

  it('admin panel is hidden', () => {
    expect(w.document.getElementById('adminPanel').style.display).toBe('none');
  });

  it('admin badge is hidden', () => {
    expect(w.document.getElementById('adminBadge').style.display).toBe('none');
  });

  it('cancel banner does not have cancelled class', () => {
    expect(w.document.getElementById('cancelBanner').classList.contains('cancelled')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// render() — RSVP list and stats
// ---------------------------------------------------------------------------

describe('render() with RSVPs', () => {
  let w;
  beforeAll(async () => {
    w = await createWindow();
    w.appState = {
      cancelled: false,
      rsvps: [
        { name: 'Alice', attending: true, guests: 2, timestamp: '' },
        { name: 'Bob',   attending: true, guests: 0, timestamp: '' },
        { name: 'Carol', attending: false, guests: 0, timestamp: '' }
      ],
      clearsAt: null
    };
    w.render();
  });
  afterAll(() => { w.close(); });

  it('renders all RSVP items', () => {
    expect(w.document.querySelectorAll('.rsvp-item')).toHaveLength(3);
  });

  it('shows correct attending + guest text', () => {
    expect(w.document.getElementById('statsAttending').textContent)
      .toBe('2 attending (+2 guests)');
  });

  it('shows correct total (attending + guests)', () => {
    // 2 attending + 2 guests = 4 total
    expect(w.document.getElementById('statsTotal').textContent).toBe('4 total');
  });

  it('marks attending players with yes class', () => {
    const statuses = w.document.querySelectorAll('.rsvp-status');
    expect(statuses[0].classList.contains('yes')).toBe(true);
    expect(statuses[1].classList.contains('yes')).toBe(true);
  });

  it('marks non-attending players with no class', () => {
    const statuses = w.document.querySelectorAll('.rsvp-status');
    expect(statuses[2].classList.contains('no')).toBe(true);
  });

  it('shows guest badge when player has guests', () => {
    const guests = w.document.querySelector('.rsvp-guests');
    expect(guests).not.toBeNull();
    expect(guests.textContent).toBe('+2');
  });
});

describe('render() — total with no guests', () => {
  let w;
  beforeAll(async () => {
    w = await createWindow();
    w.appState = {
      cancelled: false,
      rsvps: [
        { name: 'Alice', attending: true, guests: 0, timestamp: '' },
        { name: 'Bob',   attending: true, guests: 0, timestamp: '' }
      ],
      clearsAt: null
    };
    w.render();
  });
  afterAll(() => { w.close(); });

  it('stats text has no guest parenthetical', () => {
    expect(w.document.getElementById('statsAttending').textContent).toBe('2 attending');
  });

  it('total equals attending count when there are no guests', () => {
    expect(w.document.getElementById('statsTotal').textContent).toBe('2 total');
  });
});

// ---------------------------------------------------------------------------
// render() — cancelled event
// ---------------------------------------------------------------------------

describe('render() with cancelled event', () => {
  let w;
  beforeAll(async () => {
    w = await createWindow();
    w.appState = { cancelled: true, rsvps: [], clearsAt: null };
    w.render();
  });
  afterAll(() => { w.close(); });

  it('banner has cancelled class', () => {
    expect(w.document.getElementById('cancelBanner').classList.contains('cancelled')).toBe(true);
  });

  it('uncancelling removes the class', () => {
    w.appState.cancelled = false;
    w.render();
    expect(w.document.getElementById('cancelBanner').classList.contains('cancelled')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Admin mode
// ---------------------------------------------------------------------------

describe('admin mode rendering', () => {
  let w;
  beforeAll(async () => {
    w = await createWindow();
    w.adminMode = true;
    w.render();
  });
  afterAll(() => { w.close(); });

  it('header gains admin-mode class', () => {
    expect(w.document.getElementById('siteHeader').classList.contains('admin-mode')).toBe(true);
  });

  it('admin badge becomes visible', () => {
    expect(w.document.getElementById('adminBadge').style.display).toBe('block');
  });

  it('admin panel becomes visible', () => {
    expect(w.document.getElementById('adminPanel').style.display).toBe('block');
  });

  it('bottom section shows Exit Admin Mode button', () => {
    expect(w.document.getElementById('bottomSection').innerHTML)
      .toContain('Exit Admin Mode');
  });

  it('admin cancel section shows cancel button when event is not cancelled', () => {
    w.appState = { cancelled: false, rsvps: [], clearsAt: null };
    w.render();
    expect(w.document.getElementById('adminCancelSection').innerHTML)
      .toContain("Cancel today");
  });

  it('admin cancel section shows uncancel button when event is cancelled', () => {
    w.appState = { cancelled: true, rsvps: [], clearsAt: null };
    w.render();
    expect(w.document.getElementById('adminCancelSection').innerHTML)
      .toContain('Uncancel');
  });
});

describe('admin mode RSVP remove buttons', () => {
  let w;
  beforeAll(async () => {
    w = await createWindow();
    w.appState = {
      cancelled: false,
      rsvps: [
        { name: 'Alice', attending: true, guests: 0, timestamp: '' },
        { name: 'Bob',   attending: true, guests: 0, timestamp: '' }
      ],
      clearsAt: null
    };
    w.adminMode = true;
    w.render();
  });
  afterAll(() => { w.close(); });

  it('shows a remove button on every RSVP item', () => {
    expect(w.document.querySelectorAll('.rsvp-remove-btn')).toHaveLength(2);
  });

  it('remove button carries the correct data-name', () => {
    const btns = w.document.querySelectorAll('.rsvp-remove-btn');
    expect(btns[0].dataset.name).toBe('Alice');
    expect(btns[1].dataset.name).toBe('Bob');
  });

  it('remove buttons are absent when not in admin mode', () => {
    w.adminMode = false;
    w.render();
    expect(w.document.querySelectorAll('.rsvp-remove-btn')).toHaveLength(0);
  });
});

describe('exitAdminMode()', () => {
  let w;
  beforeAll(async () => {
    w = await createWindow();
    w.adminMode = true;
    w.render();
    w.exitAdminMode();
  });
  afterAll(() => { w.close(); });

  it('sets adminMode to false', () => expect(w.adminMode).toBe(false));

  it('removes admin-mode class from header', () => {
    expect(w.document.getElementById('siteHeader').classList.contains('admin-mode')).toBe(false);
  });

  it('hides the admin panel', () => {
    expect(w.document.getElementById('adminPanel').style.display).toBe('none');
  });

  it('restores Event Settings button in bottom section', () => {
    expect(w.document.getElementById('bottomSection').innerHTML)
      .toContain('Event Settings');
  });
});

// ---------------------------------------------------------------------------
// changeGuests()
// ---------------------------------------------------------------------------

describe('changeGuests()', () => {
  let w;
  beforeAll(async () => { w = await createWindow(); });
  afterAll(() => { w.close(); });
  beforeEach(() => {
    w.guests = 0;
    w.document.getElementById('guestsCount').textContent = '0';
  });

  it('increments the guest count', () => {
    w.changeGuests(1);
    expect(w.guests).toBe(1);
    expect(w.document.getElementById('guestsCount').textContent).toBe('1');
  });

  it('decrements the guest count', () => {
    w.guests = 3;
    w.changeGuests(-1);
    expect(w.guests).toBe(2);
  });

  it('does not go below 0', () => {
    w.guests = 0;
    w.changeGuests(-1);
    expect(w.guests).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// setAttending()
// ---------------------------------------------------------------------------

describe('setAttending()', () => {
  let w;
  beforeAll(async () => { w = await createWindow(); });
  afterAll(() => { w.close(); });

  it('sets attending false and activates the No button', () => {
    w.setAttending(false);
    expect(w.attending).toBe(false);
    expect(w.document.getElementById('btnNo').classList.contains('active')).toBe(true);
    expect(w.document.getElementById('btnYes').classList.contains('active')).toBe(false);
  });

  it('sets attending true and activates the Yes button', () => {
    w.setAttending(true);
    expect(w.attending).toBe(true);
    expect(w.document.getElementById('btnYes').classList.contains('active')).toBe(true);
    expect(w.document.getElementById('btnNo').classList.contains('active')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setAdminAttending()
// ---------------------------------------------------------------------------

describe('setAdminAttending()', () => {
  let w;
  beforeAll(async () => { w = await createWindow(); });
  afterAll(() => { w.close(); });

  it('activates admin No button', () => {
    w.setAdminAttending(false);
    expect(w.adminAddAttending).toBe(false);
    expect(w.document.getElementById('adminBtnNo').classList.contains('active')).toBe(true);
  });

  it('activates admin Yes button', () => {
    w.setAdminAttending(true);
    expect(w.adminAddAttending).toBe(true);
    expect(w.document.getElementById('adminBtnYes').classList.contains('active')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// changeAdminGuests()
// ---------------------------------------------------------------------------

describe('changeAdminGuests()', () => {
  let w;
  beforeAll(async () => { w = await createWindow(); });
  afterAll(() => { w.close(); });
  beforeEach(() => {
    w.adminAddGuests = 0;
    w.document.getElementById('adminGuestsCount').textContent = '0';
  });

  it('increments admin guest count', () => {
    w.changeAdminGuests(1);
    expect(w.adminAddGuests).toBe(1);
    expect(w.document.getElementById('adminGuestsCount').textContent).toBe('1');
  });

  it('does not go below 0', () => {
    w.changeAdminGuests(-1);
    expect(w.adminAddGuests).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// All Aboard promo banner
// ---------------------------------------------------------------------------

describe('All Aboard promo banner', () => {
  let w;
  beforeAll(async () => { w = await createWindow(); });
  afterAll(() => { w.close(); });

  it('renders the callout', () => {
    expect(w.document.getElementById('promoCallout')).not.toBeNull();
  });

  it('sits directly above the Your RSVP card', () => {
    const callout = w.document.getElementById('promoCallout');
    expect(callout.nextElementSibling.id).toBe('formCard');
  });

  it('reads "Head over to All Aboard to get your own event link"', () => {
    const text = w.document.getElementById('promoCallout').textContent
      .replace(/\s+/g, ' ').trim();
    expect(text).toBe('Head over to All Aboard to get your own event link');
  });

  it('links "All Aboard" to the new app', () => {
    const link = w.document.querySelector('#promoCallout a');
    expect(link.textContent.trim()).toBe('All Aboard');
    expect(link.getAttribute('href')).toBe('https://www.getallaboard.app');
  });

  it('opens the link in a new tab without leaking the referrer window', () => {
    const link = w.document.querySelector('#promoCallout a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

// ---------------------------------------------------------------------------
// First-visit All Aboard promo modal
// ---------------------------------------------------------------------------

describe('All Aboard promo modal', () => {
  const KEY = 'simple_rsvp_allaboard_promo_seen';

  it('opens on a first visit', async () => {
    const w = await createWindow();
    expect(w.document.getElementById('promoModal').classList.contains('open')).toBe(true);
    w.close();
  });

  it('records the visit in localStorage as soon as it is shown', async () => {
    const w = await createWindow();
    expect(w.localStorage.getItem(KEY)).toBe('1');
    w.close();
  });

  it('stays closed when localStorage says it was already seen', async () => {
    const w = await createWindow(null, function(window) {
      window.localStorage.setItem(KEY, '1');
    });
    expect(w.document.getElementById('promoModal').classList.contains('open')).toBe(false);
    w.close();
  });

  it('closes on Dismiss and does not reopen after a re-render', async () => {
    const w = await createWindow();
    w.document.getElementById('promoDismissBtn').click();
    expect(w.document.getElementById('promoModal').classList.contains('open')).toBe(false);
    expect(w.localStorage.getItem(KEY)).toBe('1');
    w.maybeShowPromoModal();
    expect(w.document.getElementById('promoModal').classList.contains('open')).toBe(false);
    w.close();
  });

  it('closes when the overlay backdrop is clicked', async () => {
    const w = await createWindow();
    w.document.getElementById('promoModal').click();
    expect(w.document.getElementById('promoModal').classList.contains('open')).toBe(false);
    w.close();
  });

  it('stays open when the dialog body itself is clicked', async () => {
    const w = await createWindow();
    w.document.querySelector('#promoModal .modal').click();
    expect(w.document.getElementById('promoModal').classList.contains('open')).toBe(true);
    w.close();
  });

  it('closes on Escape', async () => {
    const w = await createWindow();
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(w.document.getElementById('promoModal').classList.contains('open')).toBe(false);
    w.close();
  });

  it('carries the copy and link the funnel needs', () => {
    const dom = new JSDOM(HTML);
    const modal = dom.window.document.getElementById('promoModal');
    const text = modal.textContent.replace(/\s+/g, ' ').trim();
    expect(text).toContain('Have an event of your own?');
    expect(text).toContain('Create your own sign up links at All Aboard');
    const link = modal.querySelector('a');
    expect(link.textContent.trim()).toBe('All Aboard');
    expect(link.getAttribute('href')).toBe('https://www.getallaboard.app');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    dom.window.close();
  });

  // Storage failures must skip the modal *and* leave a working page behind.
  // Asserting only that the modal is closed would pass even if the exception
  // tore down init() and killed the app, so each case also checks that the
  // page finished booting and rendered state fetched from the server.
  const BOOTED_STATE = {
    cancelled: false,
    clearsAt: null,
    rsvps: [{ name: 'Storage Probe', attending: true, guests: 0, timestamp: 'x' }]
  };

  // Only true if init() survived and drove fetchState() -> render(). The static
  // markup ships "0 attending" and an empty-state list, so asserting on those
  // would pass even for a page whose init() threw on its first line.
  function expectAppStillBooted(w) {
    expect(w.document.getElementById('statsAttending').textContent).toBe('1 attending');
    expect(w.document.querySelector('#rsvpList .rsvp-item')).not.toBeNull();
    expect(w.document.getElementById('rsvpList').textContent).toContain('Storage Probe');
  }

  function blockStorage(mode) {
    return function(window) {
      const real = window.localStorage;
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: function(k) {
            if (mode === 'read' || mode === 'both') throw new Error('storage blocked');
            return real.getItem(k);
          },
          setItem: function(k, v) {
            if (mode === 'write' || mode === 'both') throw new Error('storage blocked');
            return real.setItem(k, v);
          }
        }
      });
    };
  }

  it('is skipped when reads throw, without breaking the page', async () => {
    const w = await createWindow(BOOTED_STATE, blockStorage('read'));
    expect(w.document.getElementById('promoModal').classList.contains('open')).toBe(false);
    expectAppStillBooted(w);
    w.close();
  });

  it('is skipped when the flag cannot be written, without breaking the page', async () => {
    // Reads succeed and return nothing, so the flag looks unset. Showing the
    // modal here would mean showing it on every single page load.
    const w = await createWindow(BOOTED_STATE, blockStorage('write'));
    expect(w.document.getElementById('promoModal').classList.contains('open')).toBe(false);
    expectAppStillBooted(w);
    w.close();
  });

  it('is skipped when storage is unavailable entirely', async () => {
    const w = await createWindow(BOOTED_STATE, blockStorage('both'));
    expect(w.document.getElementById('promoModal').classList.contains('open')).toBe(false);
    expectAppStillBooted(w);
    w.close();
  });

  it('keeps Tab inside the dialog while it is open', async () => {
    const w = await createWindow();
    w.document.getElementById('nameInput').focus();
    const ev = new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    w.document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(w.document.activeElement.id).toBe('promoDismissBtn');
    w.close();
  });

  it('releases Tab once the dialog is dismissed', async () => {
    const w = await createWindow();
    w.dismissPromoModal();
    const ev = new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    w.document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    w.close();
  });

  it('focuses the Dismiss button when it opens', async () => {
    const w = await createWindow();
    expect(w.document.activeElement.id).toBe('promoDismissBtn');
    w.close();
  });
});

// ---------------------------------------------------------------------------
// submitPin() error handling
// ---------------------------------------------------------------------------

describe('submitPin() error responses', () => {
  function respondWith(w, status, body) {
    w.fetch = function() {
      var P = w.Promise;
      return P.resolve({ status: status, json: function() { return P.resolve(body); } });
    };
  }

  function submit(w, pin) {
    w.openPinModal('admin');
    w.document.getElementById('pinInput').value = pin;
    w.submitPin();
    return new Promise(function(r) { setTimeout(r, 20); });
  }

  it('shows "Incorrect PIN." on 401 and stays out of admin mode', async () => {
    const w = await createWindow();
    respondWith(w, 401, { error: 'Incorrect PIN' });
    await submit(w, '9999');
    expect(w.adminMode).toBe(false);
    expect(w.document.getElementById('pinError').textContent).toBe('Incorrect PIN.');
    w.close();
  });

  it('shows the server message on 429 and stays out of admin mode', async () => {
    const w = await createWindow();
    respondWith(w, 429, { error: 'Too many incorrect PIN attempts. Try again later.' });
    await submit(w, '0000');
    expect(w.adminMode).toBe(false);
    expect(w.document.getElementById('pinModal').classList.contains('open')).toBe(true);
    expect(w.document.getElementById('pinError').textContent)
      .toBe('Too many incorrect PIN attempts. Try again later.');
    w.close();
  });

  it('enters admin mode on 200', async () => {
    const w = await createWindow();
    respondWith(w, 200, { ok: true });
    await submit(w, '0000');
    expect(w.adminMode).toBe(true);
    w.close();
  });
});
