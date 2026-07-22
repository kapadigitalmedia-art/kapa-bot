// Prospect-facing demo entry point — for anyone messaging the bot who
// isn't in bot_employees at all (someone exploring the WhatsApp demo,
// not a real employee of any onboarded tenant). Deliberately isolated
// from the real attendance pipeline: nothing here ever touches
// bot_employees/bot_employee_attendance, by design (confirmed choice —
// demo check-in/checkout is a cosmetic simulation only, no DB writes),
// so a prospect can never pollute real tenant data no matter what they
// type.
//
// Only 'field' (KAPA ONE Field Services) has a working demo today — the
// other 8 rows exist so prospects can see the full product lineup, but
// selecting one just points them at the Field demo or a sales contact,
// per name and title/description exactly as given (title/description are
// what render in the WhatsApp list row itself and are emoji-prefixed;
// name is the plain-text form used when interpolating into sentences —
// e.g. the "being finalized" message — where an emoji mid-sentence would
// look wrong).

const whatsapp = require('./whatsapp');

const SALES_CONTACT = 'wa.me/917305737508';

const INDUSTRIES = [
  { id: 'field', name: 'Field Services', title: '🏢 Field Services', description: 'Attendance, tasks & payroll for field teams' },
  { id: 'dine', name: 'Restaurant & Dine', title: '🍽️ Restaurant & Dine', description: 'POS, kitchen alerts & staff attendance' },
  { id: 'healthcare', name: 'Healthcare', title: '🏥 Healthcare', description: 'Patient appointments & clinic staff' },
  { id: 'ports', name: 'Ports & Logistics', title: '⚓ Ports & Logistics', description: 'Crew attendance & cargo tracking' },
  { id: 'education', name: 'Education', title: '🎓 Education', description: 'Student attendance & fee collection' },
  { id: 'hotels', name: 'Hotels & Hospitality', title: '🏨 Hotels & Hospitality', description: 'Housekeeping & guest requests' },
  { id: 'retail', name: 'Retail & Trading', title: '🛒 Retail & Trading', description: 'Inventory & staff attendance' },
  { id: 'manufacturing', name: 'Manufacturing', title: '🏭 Manufacturing', description: 'Production & shift attendance' },
  { id: 'finance', name: 'Finance Services', title: '💰 Finance Services', description: 'Client visits & compliance' },
];

function getIndustryById(id) {
  return INDUSTRIES.find((i) => i.id === id) || null;
}

/**
 * Sends the 9-row industry picker. This is a WhatsApp LIST message, not
 * buttons — buttons cap at 3, and there are 9 industries, hence
 * whatsapp.sendList (added alongside this file).
 */
async function sendIndustryPicker(tenant, to) {
  const sections = [
    {
      title: 'Industries',
      rows: INDUSTRIES.map((i) => ({ id: i.id, title: i.title, description: i.description })),
    },
  ];
  return whatsapp.sendList(
    tenant,
    to,
    "👋 Welcome to KAPA ONE! We help businesses automate attendance, tasks & approvals over WhatsApp.\n\nWhich industry are you exploring a demo for?",
    'Choose Industry',
    sections
  );
}

/**
 * Handles a list-reply industry selection. Returns { message,
 * newConvState } for the caller (routes/webhook.js) to send/persist —
 * newConvState is null for every industry except 'field', since only
 * that one has a demo to actually explore; the caller should NOT set
 * demo_exploring state for the other 8 (there's nothing to explore yet).
 * Returns null for an id that isn't one of ours at all (defensive only —
 * every real reply's id comes from the list we just sent).
 */
function handleIndustrySelection(industryId) {
  const industry = getIndustryById(industryId);
  if (!industry) return null;

  if (industry.id === 'field') {
    return {
      message: "🏢 Welcome to the KAPA ONE Field demo! This is exactly what your team's daily attendance experience would look like.\n\nTry typing 'check in' to see it in action!",
      newConvState: { step: 'demo_exploring', data: { industry: 'field' } },
    };
  }

  return {
    message: `🚧 The ${industry.name} demo is being finalized! Want to try our Field Services demo instead, or would you like to book a call with our sales team?\n\n👉 ${SALES_CONTACT} to talk to us directly`,
    newConvState: null,
  };
}

const DEMO_SHIFT_START_MINUTES = 8 * 60 + 30; // fixed demo shift: 08:30

function demoTimeLabel(now) {
  return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Cosmetic only — no bot_employee_attendance row, no employee_id, no DB
 * access at all. Status is computed against a fixed 08:30 demo shift
 * purely so the simulation looks alive (a prospect trying this at 9am
 * sees "Late", not a static canned value), matching the real
 * createCheckIn's Late/Present distinction without needing a real
 * employee's actual shift_start.
 */
function simulateDemoCheckIn() {
  const now = new Date();
  const totalMinutes = now.getHours() * 60 + now.getMinutes();
  const isLate = totalMinutes > DEMO_SHIFT_START_MINUTES;
  const statusLabel = isLate ? `Late (${totalMinutes - DEMO_SHIFT_START_MINUTES} min)` : 'Present';
  return `✅ *Checked In (Demo)*\n\nTime: ${demoTimeLabel(now)}\nStatus: ${statusLabel}`;
}

function simulateDemoCheckOut() {
  const now = new Date();
  return `✅ *Checked Out (Demo)*\n\nTime: ${demoTimeLabel(now)}`;
}

module.exports = {
  INDUSTRIES,
  getIndustryById,
  sendIndustryPicker,
  handleIndustrySelection,
  simulateDemoCheckIn,
  simulateDemoCheckOut,
};
