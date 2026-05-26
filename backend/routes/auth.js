'use strict';
/**
 * routes/auth.js
 *
 * Authentication routes – Firebase Firestore backend.
 * Security features:
 *  • bcrypt (cost 12) password hashing
 *  • JWT access tokens (8 h expiry, signed with JWT_SECRET)
 *  • Two-factor authentication via 6-digit OTP sent to the user's email
 *  • Timing-safe login (dummy bcrypt hash prevents user-enumeration)
 *  • Audit log written to Firestore on every significant auth event
 */

require('dotenv').config();
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { v4: uuid } = require('uuid');

const { collections }    = require('../db');
const { authenticate }   = require('../middleware/auth');
const { sendOtpEmail }   = require('../middleware/mailer');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

async function auditLog(userId, action, ip, details = {}, success = true) {
  try {
    await collections.auditLogs.add({
      id        : uuid(),
      userId    : userId || null,
      action,
      ipAddress : ip,
      details,
      success,
      createdAt : new Date().toISOString(),
    });
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
}

// Dummy hash prevents timing attacks when user email is not found
const DUMMY_HASH = '$2a$12$dummyhashtopreventtimingattacksonloginxxxxxxxxxxxxxxxxxxx';

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const {
      role, name, address, age, gender, phone,
      email, password, confirmPassword, patientType, specialization,
    } = req.body;

    if (!role || !name || !email || !password)
      return res.status(400).json({ error: 'Role, name, email and password are required.' });
    if (password !== confirmPassword)
      return res.status(400).json({ error: 'Passwords do not match.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!['patient', 'doctor'].includes(role))
      return res.status(400).json({ error: 'Role must be patient or doctor.' });

    // Check email uniqueness
    const existing = await collections.users.where('email', '==', email.toLowerCase()).limit(1).get();
    if (!existing.empty)
      return res.status(409).json({ error: 'Email already registered.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const id = uuid();

    await collections.users.doc(id).set({
      id,
      name,
      email          : email.toLowerCase(),
      password       : passwordHash,
      role,
      patientType    : role === 'patient' ? (patientType || 'regular') : null,
      specialization : role === 'doctor'  ? (specialization || null)   : null,
      phone          : phone   || null,
      address        : address || null,
      age            : age     ? parseInt(age, 10) : null,
      gender         : gender  || null,
      isActive       : true,
      otpCode        : null,
      otpExpiry      : null,
      createdAt      : new Date().toISOString(),
    });

    await auditLog(id, 'REGISTER', req.ip);
    res.status(201).json({ message: 'Registration successful! Please log in.' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// ── POST /api/auth/login  (MFA Step 1) ──────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    // Fetch user by email
    const snap = await collections.users.where('email', '==', email.toLowerCase()).limit(1).get();
    const user = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };

    // Always run bcrypt to prevent timing-based user enumeration
    const valid = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

    if (!user || !valid || !user.isActive) {
      await auditLog(user?.id, 'LOGIN_FAILED', req.ip, { email }, false);
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    if (role && user.role !== role)
      return res.status(401).json({ error: `This account is a ${user.role}, not a ${role}.` });

    // Generate & store OTP
    const otp    = generateOTP();
    const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await collections.users.doc(user.id).update({ otpCode: otp, otpExpiry: expiry });

    // Send OTP via email (falls back to console in dev if email not configured)
    try {
      await sendOtpEmail(user.email, user.name, otp);
      console.log(`📧 OTP sent to ${user.email}`);
    } catch (mailErr) {
      console.warn('⚠️  Email send failed – OTP (DEV ONLY):', otp, mailErr.message);
    }

    await auditLog(user.id, 'OTP_SENT', req.ip);

    // Return devOtp only in development so front-end can auto-fill for testing
    const response = { message: 'Verification code sent to your email.', userId: user.id };
    if (process.env.NODE_ENV !== 'production') response.devOtp = otp;
    res.json(response);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ── POST /api/auth/verify-otp  (MFA Step 2) ─────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp)
      return res.status(400).json({ error: 'userId and otp are required.' });

    const snap = await collections.users.doc(userId).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found.' });

    const user = { id: snap.id, ...snap.data() };

    if (!user.otpCode || new Date(user.otpExpiry) < new Date()) {
      return res.status(400).json({ error: 'Code expired. Please log in again.' });
    }
    if (user.otpCode !== String(otp)) {
      await auditLog(userId, 'OTP_FAILED', req.ip, {}, false);
      return res.status(401).json({ error: 'Incorrect verification code.' });
    }

    // Clear OTP
    await collections.users.doc(user.id).update({ otpCode: null, otpExpiry: null });

    // Issue JWT
    const token = jwt.sign(
      { userId: user.id, role: user.role, name: user.name, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '8h' },
    );

    await auditLog(userId, 'LOGIN_SUCCESS', req.ip);

    res.json({
      message : 'Login successful!',
      token,
      user    : {
        id             : user.id,
        name           : user.name,
        email          : user.email,
        role           : user.role,
        patientType    : user.patientType,
        specialization : user.specialization,
      },
    });
  } catch (err) {
    console.error('OTP verify error:', err);
    res.status(500).json({ error: 'Verification failed.' });
  }
});

// ── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  await auditLog(req.user.userId, 'LOGOUT', req.ip);
  // JWT is stateless – client must discard the token.
  // For token revocation add a Firestore blocklist here.
  res.json({ message: 'Logged out.' });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const snap = await collections.users.doc(req.user.userId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Not found.' });

    const { password, otpCode, otpExpiry, ...safe } = snap.data();
    res.json(safe);
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

module.exports = router;
