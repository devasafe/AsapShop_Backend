const router = require('express').Router();

const { FRONTEND_URL } = require('../config');

const redirectWithQuery = (dest) => (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  console.log(`🔁 Retorno MP -> ${dest}:`, req.query);
  return res.redirect(`${FRONTEND_URL}/checkout/${dest}?${qs}`);
};

// Endpoints (com aliases)
router.get('/success', redirectWithQuery('sucesso'));  // alias correto
router.get('/failure', redirectWithQuery('falha'));    // alias
router.get('/pending', redirectWithQuery('pendente'));

module.exports = router;