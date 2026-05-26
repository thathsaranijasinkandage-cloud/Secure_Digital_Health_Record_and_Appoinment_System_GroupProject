'use strict';
/**
 * routes/medical.js
 *
 * Medical records – Firebase Firestore backend.
 * Medical notes are encrypted at rest with AES-256-GCM (same algorithm as before).
 * ENCRYPTION_KEY must be a 64-character hex string in .env (32 bytes).
 */

require('dotenv').config();
const express = require('express');
const crypto  = require('crypto');
const { v4: uuid } = require('uuid');
const { collections } = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ── Encryption helpers ────────────────────────────────────────────────────────

function getKey() {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
  return key;
}

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(text || ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encryptedData : Buffer.concat([tag, encrypted]).toString('hex'),
    iv            : iv.toString('hex'),
  };
}

function decrypt(hexData, hexIv) {
  try {
    const iv  = Buffer.from(hexIv, 'hex');
    const buf = Buffer.from(hexData, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(buf.subarray(0, 16));
    return Buffer.concat([decipher.update(buf.subarray(16)), decipher.final()]).toString('utf8');
  } catch {
    return '[encrypted]';
  }
}

// ── Enrich a record with patient & doctor info ─────────────────────────────

async function enrich(record) {
  const [patientSnap, doctorSnap] = await Promise.all([
    collections.users.doc(record.patientId).get(),
    collections.users.doc(record.doctorId).get(),
  ]);
  const patient = patientSnap.exists ? patientSnap.data() : null;
  const doctor  = doctorSnap.exists  ? doctorSnap.data()  : null;

  let notes = record.notes;
  if (record.encryptedData && record.iv) {
    notes = decrypt(record.encryptedData, record.iv);
  }

  return {
    ...record,
    notes,
    patient : patient ? { id: patient.id, name: patient.name, age: patient.age, email: patient.email } : null,
    doctor  : doctor  ? { id: doctor.id,  name: doctor.name,  specialization: doctor.specialization }  : null,
  };
}

async function enrichAll(snap) {
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Promise.all(docs.map(enrich));
}

// ── GET /api/medical ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { userId, role } = req.user;
    let snap;
    if      (role === 'patient') snap = await collections.medicalRecords.where('patientId', '==', userId).orderBy('visitDate', 'desc').get();
    else if (role === 'doctor')  snap = await collections.medicalRecords.where('doctorId',  '==', userId).orderBy('visitDate', 'desc').get();
    else                         snap = await collections.medicalRecords.orderBy('visitDate', 'desc').get();

    res.json(await enrichAll(snap));
  } catch (err) {
    console.error('GET medical error:', err);
    res.status(500).json({ error: 'Failed to fetch medical records.' });
  }
});

// ── GET /api/medical/patients ─────────────────────────────────────────────────
router.get('/patients', authorize('doctor', 'admin'), async (req, res) => {
  try {
    const { userId } = req.user;

    // Get all unique patient IDs from this doctor's appointments
    const apptSnap = await collections.appointments.where('doctorId', '==', userId).get();
    const patientIds = [...new Set(apptSnap.docs.map(d => d.data().patientId))];

    if (patientIds.length === 0) return res.json([]);

    // Batch fetch patients (Firestore 'in' max 30 per query)
    const chunks = [];
    for (let i = 0; i < patientIds.length; i += 30) chunks.push(patientIds.slice(i, i + 30));

    const patients = [];
    for (const chunk of chunks) {
      const snap = await collections.users.where('id', 'in', chunk).get();
      snap.docs.forEach(d => {
        const u = d.data();
        if (u.role === 'patient') patients.push(u);
      });
    }

    // Get last visit date per patient from this doctor
    const result = await Promise.all(patients.map(async (p) => {
      const recordSnap = await collections.medicalRecords
        .where('patientId', '==', p.id)
        .where('doctorId',  '==', userId)
        .orderBy('visitDate', 'desc')
        .limit(1)
        .get();
      const lastVisit = recordSnap.empty ? null : recordSnap.docs[0].data().visitDate;
      return { id: p.id, name: p.name, age: p.age, email: p.email, patientType: p.patientType, lastVisit };
    }));

    res.json(result.sort((a, b) => a.name.localeCompare(b.name)));
  } catch (err) {
    console.error('GET patients error:', err);
    res.status(500).json({ error: 'Failed to fetch patients.' });
  }
});

// ── GET /api/medical/patient/:patientId ───────────────────────────────────────
router.get('/patient/:patientId', authorize('doctor', 'admin'), async (req, res) => {
  try {
    const snap = await collections.medicalRecords
      .where('patientId', '==', req.params.patientId)
      .orderBy('visitDate', 'desc')
      .get();
    res.json(await enrichAll(snap));
  } catch (err) {
    console.error('GET patient records error:', err);
    res.status(500).json({ error: 'Failed to fetch records.' });
  }
});

// ── POST /api/medical ─────────────────────────────────────────────────────────
router.post('/', authorize('doctor', 'admin'), async (req, res) => {
  try {
    const { patientId, diagnosis, notes, recordType, visitDate, appointmentId } = req.body;
    if (!patientId || !diagnosis || !visitDate)
      return res.status(400).json({ error: 'patientId, diagnosis and visitDate are required.' });

    const patientSnap = await collections.users.doc(patientId).get();
    if (!patientSnap.exists || patientSnap.data().role !== 'patient')
      return res.status(404).json({ error: 'Patient not found.' });

    const { encryptedData, iv } = encrypt(notes || '');
    const id = uuid();

    await collections.medicalRecords.doc(id).set({
      id,
      patientId,
      doctorId      : req.user.userId,
      appointmentId : appointmentId || null,
      diagnosis,
      notes         : notes || '',
      recordType    : recordType || 'consultation',
      encryptedData,
      iv,
      visitDate,
      createdAt     : new Date().toISOString(),
    });

    res.status(201).json({ message: 'Medical record saved.', recordId: id });
  } catch (err) {
    console.error('POST medical error:', err);
    res.status(500).json({ error: 'Failed to save record.' });
  }
});

// ── PUT /api/medical/:id ──────────────────────────────────────────────────────
router.put('/:id', authorize('doctor', 'admin'), async (req, res) => {
  try {
    const snap = await collections.medicalRecords.doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: 'Record not found.' });

    const record = snap.data();
    if (req.user.role === 'doctor' && record.doctorId !== req.user.userId)
      return res.status(403).json({ error: 'You can only edit your own records.' });

    const { diagnosis, notes, recordType } = req.body;
    const notesValue = notes !== undefined ? notes : record.notes;
    const { encryptedData, iv } = encrypt(notesValue ?? '');

    await collections.medicalRecords.doc(req.params.id).update({
      diagnosis     : diagnosis  ?? record.diagnosis,
      notes         : notesValue ?? record.notes,
      recordType    : recordType ?? record.recordType,
      encryptedData,
      iv,
    });

    res.json({ message: 'Record updated.' });
  } catch (err) {
    console.error('PUT medical error:', err);
    res.status(500).json({ error: 'Update failed.' });
  }
});

module.exports = router;
