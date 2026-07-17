/**
 * Rotas dos webhooks (integrações externas).
 */
const express = require('express');
const router = express.Router();

const { webhookSmoobu } = require('../controllers/webhookController');

// Smoobu → nova reserva.
// POST /webhooks/smoobu
router.post('/smoobu', webhookSmoobu);

module.exports = router;
