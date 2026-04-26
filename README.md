# Secure_Digital_Health_Record_and_Appoinment_System_GroupProject
Healthcare web application project
## Database Design
Database Member: Ghazaleh Afarid

### Users Collection
-name
-email
-password
-role(patient/doctor)
-age
-address
-gender
-createdAt

### Doctor Fields:
-specialty

### Appointments Collection
-patientId
-doctorId
-doctorName
-doctorSpecialty
-date
-time
-status (pending / approved / cancelled / completed)
-symptoms
-appointmentType (Normal / Emergency)
-cancelledAt

### MedicalRecords Collection
-patientId
-doctorId
-date
-diagnosis
-prescription
-notes
-createdAt

## Relationships:
- One patient → many appointments
- One doctor → many appointments
- One patient → many medical records

## Optimization:
-use patientId and doctorId for fast queries
-store doctorName to avoid extra queries
