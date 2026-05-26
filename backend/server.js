'use strict';
/**
 * server.js – MediX Express server
 *
 * Security features enabled:
 *  • Helmet (sets secure HTTP headers)
 *  • CORS (restrict origins in production via CORS_ORIGIN env var)
 *  • express-rate-limit (global + per-route brute-force protection)
 *  • JWT authentication (see middleware/auth.js)
 *  • bcrypt password hashing (see routes/auth.js)
 *  • OTP / MFA via email (see middleware/mailer.js + routes/auth.js)
 *  • AES-256-GCM encryption for medical notes (see routes/medical.js)
 *
 * HTTPS:
 *  For local dev:  use a reverse proxy such as Caddy or ngrok (recommended).
 *  For production: terminate TLS at your load balancer / Caddy / Nginx.
 *  If you need Node.js native HTTPS, replace app.listen() with:
 *
 *    const https = require('https');
 *    const fs    = require('fs');
 *    https.createServer({
 *      key:  fs.readFileSync('./certs/key.pem'),
 *      cert: fs.readFileSync('./certs/cert.pem'),
 *    }, app).listen(PORT, ...);
 */

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const app = express();

// ── Security middleware ───────────────────────────────────────────────────────

// Helmet sets X-Frame-Options, X-Content-Type-Options, HSTS, etc.
app.use(helmet({ contentSecurityPolicy: false }));

// CORS – in production set CORS_ORIGIN to your front-end domain
const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin      : allowedOrigin,
  credentials : true,
}));

app.use(express.json({ limit: '10kb' })); // reject oversized bodies

// ── Rate limiting ─────────────────────────────────────────────────────────────

// General API: 300 req / 15 min per IP
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

// Login: 15 attempts / 15 min (brute-force protection)
app.use('/api/auth/login', rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 15,
  message  : { error: 'Too many login attempts. Try again in 15 minutes.' },
}));

// OTP verification: 15 attempts / 15 min
app.use('/api/auth/verify-otp', rateLimit({
  windowMs : 15 * 60 * 1000,
  max      : 15,
  message  : { error: 'Too many attempts. Try again in 15 minutes.' },
}));

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/medical',      require('./routes/medical'));
app.use('/api/users',        require('./routes/users'));

// Health check
app.get('/api/health', (req, res) =>
  res.json({ status: 'OK', timestamp: new Date().toISOString() }),
);

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('\n┌──────────────────────────────────────────────────┐');
  console.log(`│  🏥  MediX Server running on port ${PORT}             │`);
  console.log('│  🔒  Firebase Firestore + JWT + bcrypt + MFA      │');
  console.log('└──────────────────────────────────────────────────┘');
  console.log(`\n   Frontend : http://localhost:${PORT}`);
  console.log(`   API Base : http://localhost:${PORT}/api`);
  console.log('\n   Endpoints:');
  console.log('   POST   /api/auth/register');
  console.log('   POST   /api/auth/login          (MFA step 1 – sends OTP email)');
  console.log('   POST   /api/auth/verify-otp     (MFA step 2 – returns JWT)');
  console.log('   GET    /api/auth/me');
  console.log('   POST   /api/auth/logout');
  console.log('   GET    /api/users/doctors');
  console.log('   GET    /api/users/patients');
  console.log('   GET    /api/users/dashboard');
  console.log('   GET    /api/appointments');
  console.log('   POST   /api/appointments');
  console.log('   PUT    /api/appointments/:id');
  console.log('   PATCH  /api/appointments/:id/cancel');
  console.log('   PATCH  /api/appointments/:id/status');
  console.log('   GET    /api/appointments/stats');
  console.log('   GET    /api/appointments/today');
  console.log('   POST   /api/appointments/waiting-list');
  console.log('   GET    /api/medical');
  console.log('   POST   /api/medical');
  console.log('   PUT    /api/medical/:id');
  console.log('   GET    /api/medical/patients');
  console.log('   GET    /api/medical/patient/:patientId\n');
});
