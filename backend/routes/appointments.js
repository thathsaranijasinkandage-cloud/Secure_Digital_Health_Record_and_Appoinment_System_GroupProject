'use strict';
/**
 * routes/appointments.js
 *
 * All appointment CRUD – Firebase Firestore backend.
 * Mirrors the original SQLite route surface exactly so no front-end changes needed.
 */

const express = require('express');
const { v4: uuid } = require('uuid');
const { collections } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch a single document and return plain object, or null */
async function getDoc(collection, id) {
  const snap = await collection.doc(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/** Attach patient & doctor sub-objects to an appointment */
async function enrich(appt) {
  const [patientSnap, doctorSnap] = await Promise.all([
    collections.users.doc(appt.patientId).get(),
    collections.users.doc(appt.doctorId).get(),
  ]);
  const patient = patientSnap.exists ? patientSnap.data() : null;
  const doctor  = doctorSnap.exists  ? doctorSnap.data()  : null;

  return {
    ...appt,
    patient: patient ? { id: patient.id, name: patient.name, email: patient.email, patientType: patient.patientType } : null,
    doctor : doctor  ? { id: doctor.id,  name: doctor.name,  specialization: doctor.specialization }                  : null,
  };
}

async function enrichAll(snaps) {
  const docs = snaps.docs.map(d => ({ id: d.id, ...d.data() }));
  return Promise.all(docs.map(enrich));
}

// ── GET /api/appointments ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { userId, role } = req.user;
    let snap;
    if      (role === 'patient') snap = await collections.appointments.where('patientId', '==', userId).orderBy('date', 'desc').get();
    else if (role === 'doctor')  snap = await collections.appointments.where('doctorId',  '==', userId).orderBy('date', 'asc').get();
    else                         snap = await collections.appointments.orderBy('date', 'asc').get();

    const enriched = await enrichAll(snap);
    res.json(enriched);
  } catch (err) {
    console.error('GET appointments error:', err);
    res.status(500).json({ error: 'Failed to fetch appointments.' });
  }
});

// ── GET /api/appointments/stats ──────────────────────────────────────────────
router.get('/stats', authorize('doctor', 'admin'), async (req, res) => {
  try {
    const { userId } = req.user;
    const today = new Date().toISOString().split('T')[0];

    const [allSnap, todaySnap, pendingSnap] = await Promise.all([
      collections.appointments.where('doctorId', '==', userId).get(),
      collections.appointments.where('doctorId', '==', userId).where('date', '==', today).get(),
      collections.appointments.where('doctorId', '==', userId).where('status', '==', 'pending').get(),
    ]);

    const patientIds   = new Set(allSnap.docs.map(d => d.data().patientId));
    const todayNotCancelled = todaySnap.docs.filter(d => d.data().status !== 'cancelled');

    res.json({
      totalPatients  : patientIds.size,
      todayAppts     : todayNotCancelled.length,
      pending        : pendingSnap.size,
    });
  } catch (err) {
    console.error('GET stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// ── GET /api/appointments/today ──────────────────────────────────────────────
router.get('/today', authorize('doctor', 'admin'), async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const snap  = await collections.appointments
      .where('doctorId', '==', req.user.userId)
      .where('date', '==', today)
      .orderBy('time', 'asc')
      .get();
    res.json(await enrichAll(snap));
  } catch (err) {
    console.error('GET today error:', err);
    res.status(500).json({ error: 'Failed to fetch today\'s appointments.' });
  }
});

// ── POST /api/appointments ───────────────────────────────────────────────────
router.post('/', authorize('patient', 'admin'), async (req, res) => {
  try {
    const { doctorId, date, time, reason, appointmentType } = req.body;
    if (!doctorId || !date || !time)
      return res.status(400).json({ error: 'Doctor, date and time are required.' });

    const doctorSnap = await collections.users.doc(doctorId).get();
    if (!doctorSnap.exists || doctorSnap.data().role !== 'doctor')
      return res.status(404).json({ error: 'Doctor not found.' });

    // Conflict check
    const conflict = await collections.appointments
      .where('doctorId', '==', doctorId)
      .where('date', '==', date)
      .where('time', '==', time)
      .get();

    const activeConflict = conflict.docs.find(d => !['cancelled', 'rejected'].includes(d.data().status));
    if (activeConflict)
      return res.status(409).json({ error: 'This time slot is already booked. Please choose another time.' });

    const id = uuid();
    await collections.appointments.doc(id).set({
      id,
      patientId       : req.user.userId,
      doctorId,
      date,
      time,
      reason          : reason || '',
      appointmentType : appointmentType || 'normal',
      status          : 'pending',
      cancellationReason: null,
      cancelledBy     : null,
      createdAt       : new Date().toISOString(),
    });

    const doctor = doctorSnap.data();
    res.status(201).json({
      message       : `Appointment booked with ${doctor.name} on ${date} at ${time}.`,
      appointmentId : id,
    });
  } catch (err) {
    console.error('POST appointment error:', err);
    res.status(500).json({ error: 'Booking failed.' });
  }
});

// ── PUT /api/appointments/:id ────────────────────────────────────────────────
router.put('/:id', authorize('patient'), async (req, res) => {
  try {
    const appt = await getDoc(collections.appointments, req.params.id);
    if (!appt) return res.status(404).json({ error: 'Not found.' });
    if (appt.patientId !== req.user.userId) return res.status(403).json({ error: 'Not your appointment.' });
    if (!['pending', 'approved'].includes(appt.status))
      return res.status(400).json({ error: `Cannot edit a ${appt.status} appointment.` });

    const { date, time, reason } = req.body;
    await collections.appointments.doc(req.params.id).update({
      date   : date   || appt.date,
      time   : time   || appt.time,
      reason : reason || appt.reason,
    });
    res.json({ message: 'Appointment updated.' });
  } catch (err) {
    console.error('PUT appointment error:', err);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// ── PATCH /api/appointments/:id/cancel ──────────────────────────────────────
router.patch('/:id/cancel', async (req, res) => {
  try {
    const { userId, role } = req.user;
    const appt = await getDoc(collections.appointments, req.params.id);
    if (!appt) return res.status(404).json({ error: 'Not found.' });
    if (role === 'patient' && appt.patientId !== userId)
      return res.status(403).json({ error: 'Not your appointment.' });
    if (['cancelled', 'completed', 'rejected'].includes(appt.status))
      return res.status(400).json({ error: `Cannot cancel: already ${appt.status}.` });

    await collections.appointments.doc(appt.id).update({
      status             : 'cancelled',
      cancellationReason : req.body.cancellationReason || 'No reason given',
      cancelledBy        : userId,
    });

    // Notify first person on waiting list
    const waitSnap = await collections.waitingList
      .where('doctorId', '==', appt.doctorId)
      .where('status', '==', 'waiting')
      .orderBy('createdAt', 'asc')
      .limit(1)
      .get();

    let waitingListNotified = false;
    if (!waitSnap.empty) {
      const next = waitSnap.docs[0];
      await next.ref.update({ status: 'notified' });
      waitingListNotified = true;
      const patientSnap = await collections.users.doc(next.data().patientId).get();
      if (patientSnap.exists) {
        const p = patientSnap.data();
        console.log(`📬 Slot freed: notified ${p.name} (${p.email}) for ${appt.date} ${appt.time}`);
      }
    }

    res.json({ message: 'Appointment cancelled.', waitingListNotified });
  } catch (err) {
    console.error('PATCH cancel error:', err);
    res.status(500).json({ error: 'Cancellation failed.' });
  }
});

// ── PATCH /api/appointments/:id/status ──────────────────────────────────────
router.patch('/:id/status', authorize('doctor', 'admin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected', 'completed'].includes(status))
      return res.status(400).json({ error: 'Invalid status.' });

    const appt = await getDoc(collections.appointments, req.params.id);
    if (!appt) return res.status(404).json({ error: 'Not found.' });
    if (req.user.role === 'doctor' && appt.doctorId !== req.user.userId)
      return res.status(403).json({ error: 'Not your appointment.' });

    await collections.appointments.doc(req.params.id).update({ status });
    res.json({ message: `Appointment marked as ${status}.` });
  } catch (err) {
    console.error('PATCH status error:', err);
    res.status(500).json({ error: 'Status update failed.' });
  }
});

// ── POST /api/appointments/waiting-list ─────────────────────────────────────
router.post('/waiting-list', authorize('patient'), async (req, res) => {
  try {
    const { doctorId, preferredDate } = req.body;
    const existing = await collections.waitingList
      .where('patientId', '==', req.user.userId)
      .where('doctorId', '==', doctorId)
      .where('status', 'in', ['waiting', 'notified'])
      .limit(1)
      .get();

    if (!existing.empty)
      return res.status(409).json({ error: 'Already on waiting list for this doctor.' });

    const id = uuid();
    await collections.waitingList.doc(id).set({
      id,
      patientId     : req.user.userId,
      doctorId,
      preferredDate : preferredDate || null,
      status        : 'waiting',
      createdAt     : new Date().toISOString(),
    });
    res.status(201).json({ message: 'Added to waiting list.', id });
  } catch (err) {
    console.error('Waiting list error:', err);
    res.status(500).json({ error: 'Failed to join waiting list.' });
  }
});

module.exports = router;
