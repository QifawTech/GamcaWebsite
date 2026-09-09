# GAMCA — Go-live replace list (for AWS team)

Code is pushed as-tested locally. Only replace these values on the server (never commit `.env`):

## 1. `backend/.env`
```
RAZORPAY_KEY_ID     : rzp_test_...  →  rzp_live_... (live key)
RAZORPAY_KEY_SECRET : test secret   →  live secret
SMTP_USER           : testing mail  →  owner mail
SMTP_PASS           : testing app password → owner mail app password
SEND_TO_OWNER       : false         →  true
TEST_MAIL           : (leave as is, unused when SEND_TO_OWNER=true)
OWNER_MAIL          : gamcamedicaltrz@gmail.com (receiver)
APPOINTMENT_AMOUNT_PAISE : 145000 (Rs 1450, do not change)
DB_DISABLED         : true
CORS_ORIGIN         : https://gamcawafid.in,https://www.gamcawafid.in
```

## 2. `index.html` (one line, in the payment script)
```
const API_BASE = ""  →  const API_BASE = "https://api.gamcawafid.in"
```
(Backend URL. Then re-upload `index.html` to S3 + CloudFront invalidation for `/index.html`.)

## 3. After live
- One real Rs 1450 test payment → check green success modal + owner mail → refund it from Razorpay dashboard.
- Rotate the credentials shared in chat. Delete temp IAM users `deployer`, `deploy-reader`.
