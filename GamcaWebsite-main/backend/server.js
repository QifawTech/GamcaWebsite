require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Razorpay = require('razorpay');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors({ origin: (process.env.CORS_ORIGIN || '').split(',').filter(Boolean).length ? process.env.CORS_ORIGIN.split(',') : true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const AMOUNT_PAISE = parseInt(process.env.APPOINTMENT_AMOUNT_PAISE || '145000', 10); // Rs 1450
const OWNER_WHATSAPP = process.env.OWNER_WHATSAPP || '919894195050';
const TEST_MAIL = process.env.TEST_MAIL || 'rasheedrah6@gmail.com';
const OWNER_MAIL = process.env.OWNER_MAIL || 'gamcamedicaltrz@gmail.com';
// For local testing send to test mail. Set SEND_TO_OWNER=true in production.
const MAIL_TO = process.env.SEND_TO_OWNER === 'true' ? OWNER_MAIL : TEST_MAIL;

if (!KEY_ID || !KEY_SECRET) {
  console.warn('[WARN] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing in .env');
}
const razorpay = new Razorpay({ key_id: KEY_ID || 'test', key_secret: KEY_SECRET || 'test' });

// ---- Simple local JSON file DB (local testing). Set DB_DISABLED=true in production (no DB, email = record) ----
const DB_DISABLED = process.env.DB_DISABLED === 'true';
const DB_PATH = path.join(__dirname, 'db.json');
const memDb = [];
function readDb() {
  if (DB_DISABLED) return memDb;
  try {
    if (!fs.existsSync(DB_PATH)) { fs.writeFileSync(DB_PATH, '[]'); return []; }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8') || '[]');
  } catch (e) { console.error('DB read error', e); return []; }
}
function writeDb(rows) { if (DB_DISABLED) { memDb.length = 0; memDb.push(...rows); return; } fs.writeFileSync(DB_PATH, JSON.stringify(rows, null, 2)); }
function saveBooking(b) { const rows = readDb(); rows.push(b); writeDb(rows); return b; }
function updateBookingByOrder(orderId, patch) {
  const rows = readDb();
  const i = rows.findIndex(r => r.orderId === orderId);
  if (i >= 0) { rows[i] = { ...rows[i], ...patch }; writeDb(rows); return rows[i]; }
  return null;
}

// ---- Email (free Gmail SMTP). If SMTP_USER/PASS missing, log only so testing still works ----
function getMailer() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendBookingEmail(booking) {
  const subject = `✅ New Paid Appointment - ${booking.fullName} - ${booking.country} - Rs 1450`;
  const text =
`New GAMCA appointment booking (PAID)

Name: ${booking.fullName}
Phone: ${booking.phone}
Email: ${booking.email}
Country: ${booking.country}
Gender: ${booking.gender}
Marital: ${booking.maritalStatus}
Passport: ${booking.passportNo}
Position: ${booking.position}
Remarks: ${booking.remarks || 'N/A'}

Amount: Rs ${(booking.amount / 100).toFixed(2)}
Order ID: ${booking.orderId}
Payment ID: ${booking.paymentId}
Date: ${booking.paidAt || booking.createdAt}`;

  const mailer = getMailer();
  if (!mailer) {
    console.log('--- EMAIL (SMTP not configured, logging only) ---');
    console.log('To:', MAIL_TO);
    console.log('Subject:', subject);
    console.log(text);
    console.log('--- END EMAIL ---');
    return { logged: true, to: MAIL_TO };
  }
  await mailer.sendMail({ from: process.env.SMTP_USER, to: MAIL_TO, subject, text });
  return { sent: true, to: MAIL_TO };
}

// ---- Serve frontend statically so localhost:3000 shows the website ----
app.use(express.static(path.join(__dirname, '..')));
app.use('/static', express.static(path.join(__dirname, '..', 'static')));

app.get('/api/health', (req, res) => res.json({ ok: true, amount: AMOUNT_PAISE }));

app.get('/api/config', (req, res) => {
  res.json({ keyId: KEY_ID, amount: AMOUNT_PAISE, amountRs: AMOUNT_PAISE / 100 });
});

app.post('/api/create-order', async (req, res) => {
  try {
    const { country, fullName, gender, maritalStatus, passportNo, position, phone, email, remarks } = req.body || {};
    if (!country || !fullName || !phone || !email || !passportNo || !position || !gender || !maritalStatus) {
      return res.status(400).json({ error: 'Please fill all required fields.' });
    }
    const order = await razorpay.orders.create({
      amount: AMOUNT_PAISE,
      currency: 'INR',
      receipt: `gamca_${Date.now()}`,
      notes: { country, fullName, passportNo }
    });
    saveBooking({
      orderId: order.id, amount: AMOUNT_PAISE, status: 'created',
      country, fullName, gender, maritalStatus, passportNo, position, phone, email, remarks: remarks || '',
      createdAt: new Date().toISOString()
    });
    res.json({ orderId: order.id, amount: AMOUNT_PAISE, keyId: KEY_ID });
  } catch (e) {
    console.error('create-order error', e);
    res.status(500).json({ error: 'Failed to create order. Check keys / network.' });
  }
});

app.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details.' });
    }
    const expected = crypto.createHmac('sha256', KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    if (expected !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed.' });
    }
    const booking = updateBookingByOrder(razorpay_order_id, {
      status: 'paid', paymentId: razorpay_payment_id,
      paidAt: new Date().toISOString()
    });
    let emailResult = null;
    if (booking) { emailResult = await sendBookingEmail(booking); }
    res.json({
      success: true,
      message: 'Appointment Booked Successfully. Payment Completed.',
      booking, emailResult,
      whatsapp: `https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent(
`Hi GAMCA Medical,

Payment Successful - New Appointment Booking

Name: ${booking?.fullName}
Mobile: ${booking?.phone}
Email: ${booking?.email}
Country: ${booking?.country}
Passport: ${booking?.passportNo}
Position: ${booking?.position}
Payment ID: ${razorpay_payment_id}
Amount: Rs ${(AMOUNT_PAISE / 100).toFixed(2)}

Please process this appointment booking.`)}`
    });
  } catch (e) {
    console.error('verify error', e);
    res.status(500).json({ error: 'Verification failed.' });
  }
});

app.get('/api/bookings', (req, res) => res.json(readDb()));

app.listen(PORT, () => {
  console.log(`GAMCA backend running at http://localhost:${PORT}`);
  console.log(`Amount: Rs ${(AMOUNT_PAISE / 100).toFixed(2)} | Mail to: ${MAIL_TO} | WhatsApp: ${OWNER_WHATSAPP}`);
});
