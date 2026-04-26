# Secure_Digital_Health_Record_and_Appoinment_System_GroupProject
Healthcare web application project
Database Design
Database Member: Ghazaleh Afarid
Collections

Users
-name
-email
-password
-role(patient/doctor)
-age
-address
-gender
-createdAt

For doctors:
-specialty
-doctorId

Appointments:
-patientId
-doctorId
-docrotName
-doctorSpecialty
-date
-time
-status
-symptoms
-appointmentType
-cancelledAt

Medical Records:
-patientId
-doctorId
-date
-diagnosis
-prescription
-notes
-createdAt

Relationships:
- One patient → many appointments
- One doctor → many appointments
- One patient → many medical records

Optimization:
-use patientId and doctorId for fast queries
-store doctorName to avoid extra queries
