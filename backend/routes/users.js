'use strict';
/**
 * routes/users.js
 *
 * User utility routes – Firebase Firestore backend.
 */

const express = require('express');
const { collections } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ── GET /api/users/doctors ────────────────────────────────────────────────────
// Populates the doctor dropdown on book-appointment.html
router.get('/doctors', async (req, res) => {
  try {
    const snap = await collections.users
      .where('role', '==', 'doctor')
      .where('isActive', '==', true)
      .orderBy('name', 'asc')
      .get();

    const doctors = snap.docs.map(d => {
      const u = d.data();
      return { id: u.id, name: u.name, specialization: u.specialization };
    });
    res.json(doctors);
  } catch (err) {
    console.error('GET doctors error:', err);
    res.status(500).json({ error: 'Failed to fetch doctors.' });
  }
});

// ── GET /api/users/patients ───────────────────────────────────────────────────
// For doctor / admin use
router.get('/patients', authorize('doctor', 'admin'), async (req, res) => {
  try {
    const snap = await collections.users
      .where('role', '==', 'patient')
      .where('isActive', '==', true)
      .orderBy('name', 'asc')
      .get();

    const patients = snap.docs.map(d => {
      const u = d.data();
      return { id: u.id, name: u.name, age: u.age, email: u.email, phone: u.phone, patientType: u.patientType, createdAt: u.createdAt };
    });
    res.json(patients);
  } catch (err) {
    console.error('GET patients error:', err);
    res.status(500).json({ error: 'Failed to fetch patients.' });
  }
});

// ── GET /api/users/dashboard ──────────────────────────────────────────────────
// Patient dashboard stat cards
router.get('/dashboard', authorize('patient'), async (req, res) => {
  try {
    const { userId } = req.user;

    const [allAppts, upcomingAppts, records] = await Promise.all([
      collections.appointments.where('patientId', '==', userId).get(),
      collections.appointments
        .where('patientId', '==', userId)
        .where('status', 'in', ['pending', 'approved'])
        .get(),
      collections.medicalRecords.where('patientId', '==', userId).get(),
    ]);

    res.json({
      totalAppointments    : allAppts.size,
      upcomingAppointments : upcomingAppts.size,
      medicalRecords       : records.size,
    });
  } catch (err) {
    console.error('GET dashboard error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats.' });
  }
});

module.exports = router;
